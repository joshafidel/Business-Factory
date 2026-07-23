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
 *   steps run in-process AFTER the HTTP response via next/server's after(),
 *   so requests stay fast and the platform needs no Redis. DELAY steps are
 *   capped at 10s inline; cron schedules require the worker.
 */
const MAX_INLINE_DELAY_MS = 10_000;

const inlineAdvance: EnqueueAdvance = async (runId, organizationId, opts) => {
  after(async () => {
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
