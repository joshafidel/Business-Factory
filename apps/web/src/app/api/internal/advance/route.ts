import { timingSafeEqual } from "node:crypto";
import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";
import { NextResponse, type NextRequest } from "next/server";
import { after } from "next/server";
import { advanceWorkflowRun } from "@bf/workflows";
import { advanceSignature, dispatchAdvance } from "@/lib/execution";

export const maxDuration = 300;

const log = createLogger("web:internal-advance");

/** Max in-invocation sleep for DELAY steps dispatched through this route. */
const MAX_DELAY_MS = 60_000;

/**
 * Self-dispatch endpoint for inline workflow execution. Each step advance is
 * POSTed here by the previous invocation, so every step gets its own fresh
 * serverless invocation (and its own maxDuration budget) instead of the whole
 * pipeline sharing one. Authenticated with an HMAC over the run id + a
 * timestamp (SECRET_ENCRYPTION_KEY) — no session, not callable usefully by
 * outsiders. Responds 202 immediately; the actual step work runs via after().
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: {
    runId?: string;
    organizationId?: string;
    delayMs?: number;
    ts?: number;
    sig?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { runId, organizationId, delayMs, ts, sig } = body;
  if (!runId || !organizationId || !ts || !sig) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }
  if (Math.abs(Date.now() - ts) > 5 * 60_000) {
    return NextResponse.json({ error: "Stale request" }, { status: 403 });
  }
  const env = loadEnv();
  const expected = advanceSignature(env.SECRET_ENCRYPTION_KEY, runId, ts);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(sig), "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return NextResponse.json({ error: "Bad signature" }, { status: 403 });
  }

  after(async () => {
    try {
      if (delayMs && delayMs > 0) {
        await new Promise((r) => setTimeout(r, Math.min(delayMs, MAX_DELAY_MS)));
      }
      await advanceWorkflowRun(runId, dispatchAdvance);
    } catch (err) {
      log.error({ runId, err }, "dispatched advance failed");
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
