import { can } from "@bf/shared";
import { PlatformError, toErrorRecord } from "@bf/shared";
import { startWorkflowRun } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dispatchAdvance } from "@/lib/execution";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 300;

const bodySchema = z.object({ input: z.record(z.unknown()).default({}) });

/**
 * API trigger for workflows (TriggerType.API): start a run of the workflow
 * identified by key. Session-authenticated; requires workflows:execute.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> },
): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "workflows:execute")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkRateLimit(`api-run:${ctx.userId}`, 30, 60))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const { key } = await params;
  let input: Record<string, unknown> = {};
  try {
    const parsed = bodySchema.parse(await request.json().catch(() => ({})));
    input = parsed.input;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    const run = await startWorkflowRun({
      organizationId: ctx.organizationId,
      workflowKey: key,
      input,
      triggeredBy: { kind: "api", id: ctx.userId },
      enqueueAdvance: dispatchAdvance,
    });
    return NextResponse.json({ runId: run.id, status: run.status }, { status: 202 });
  } catch (err) {
    if (err instanceof PlatformError) {
      const rec = toErrorRecord(err);
      return NextResponse.json(
        { error: rec.message, code: rec.code },
        { status: rec.code === "NOT_FOUND" ? 404 : 400 },
      );
    }
    throw err;
  }
}
