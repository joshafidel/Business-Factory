import { createHmac } from "node:crypto";
import { loadEnv } from "@bf/config";
import { getExecutionMode, enqueueWorkflowAdvance } from "@bf/queue";
import { advanceWorkflowRun, type EnqueueAdvance } from "@bf/workflows";
import { createLogger } from "@bf/shared";
import { after } from "next/server";

const log = createLogger("web:execution");

/**
 * Workflow advancement dispatcher for the web app.
 *
 * - queue mode (REDIS_URL configured): enqueue a BullMQ job; the separate
 *   worker process executes steps. Full feature set (schedules, long delays,
 *   retries with real backoff).
 * - inline mode (serverless-only deploys, e.g. Vercel without a worker):
 *   each step advance is POSTed to /api/internal/advance so it runs in its
 *   own serverless invocation with its own maxDuration budget — long steps
 *   (video rendering, animation polling) don't eat the whole pipeline's
 *   clock. When no public base URL is resolvable (local dev), steps run
 *   in-process after the HTTP response via next/server's after().
 */
const MAX_INLINE_DELAY_MS = 10_000;

export function advanceSignature(secret: string, runId: string, ts: number): string {
  return createHmac("sha256", secret).update(`advance:${runId}:${ts}`).digest("hex");
}

/** Base URL this deployment can reach itself on (self-dispatch target). */
function selfBaseUrl(): string | undefined {
  const env = loadEnv();
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return undefined;
}

const inlineAdvance: EnqueueAdvance = async (runId, organizationId, opts) => {
  const base = selfBaseUrl();
  after(async () => {
    if (base) {
      try {
        const env = loadEnv();
        const ts = Date.now();
        const res = await fetch(`${base}/api/internal/advance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            runId,
            organizationId,
            delayMs: opts?.delayMs,
            ts,
            sig: advanceSignature(env.SECRET_ENCRYPTION_KEY, runId, ts),
          }),
        });
        if (res.status === 202) return;
        log.warn({ runId, status: res.status }, "self-dispatch rejected; advancing in-process");
      } catch (err) {
        log.warn({ runId, err }, "self-dispatch failed; advancing in-process");
      }
    }
    // Fallback: run the step in this invocation's after() window.
    try {
      if (opts?.delayMs) {
        await new Promise((r) => setTimeout(r, Math.min(opts.delayMs ?? 0, MAX_INLINE_DELAY_MS)));
      }
      await advanceWorkflowRun(runId, inlineAdvance);
    } catch (err) {
      // The engine records failures on the run itself; this catch only
      // guards against unexpected crashes in the inline scheduler.
      log.error({ runId, organizationId, err }, "inline advance failed");
    }
  });
};

export function getWebExecutionMode(): "queue" | "inline" {
  return getExecutionMode();
}

/** Use for every startWorkflowRun / applyApprovalDecision call in the web app. */
export const dispatchAdvance: EnqueueAdvance = async (runId, organizationId, opts) => {
  if (getExecutionMode() === "inline") {
    await inlineAdvance(runId, organizationId, opts);
  } else {
    await enqueueWorkflowAdvance(runId, organizationId, opts);
  }
};
