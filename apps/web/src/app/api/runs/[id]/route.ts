import { prisma } from "@bf/database";
import { can, createLogger, microToUsd } from "@bf/shared";
import { NextResponse } from "next/server";
import { dispatchAdvance } from "@/lib/execution";
import { getOrgContext } from "@/lib/session";

const log = createLogger("web:runs-api");

/**
 * A step stuck RUNNING this long means its serverless invocation died
 * (timeout/OOM) before recording an outcome — nothing will ever advance the
 * run again on its own.
 */
const STUCK_STEP_MS = 7 * 60_000;

/** Org-scoped run status for API consumers and polling. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "runs:read")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const run = await prisma.workflowRun.findFirst({
    where: { id, organizationId: ctx.organizationId },
    include: {
      workflow: { select: { key: true, name: true } },
      stepRuns: {
        orderBy: { createdAt: "asc" },
        select: { stepKey: true, status: true, startedAt: true },
      },
      approvals: { select: { id: true, status: true, title: true } },
      assets: { select: { id: true, name: true, approvalStatus: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Self-healing: this endpoint is polled while runs execute, so use it to
  // detect steps whose invocation died without recording an outcome and
  // re-dispatch. The engine retries the step in a fresh invocation.
  if (run.status === "RUNNING") {
    const latest = run.stepRuns[run.stepRuns.length - 1];
    const startedAt = latest?.startedAt ? new Date(latest.startedAt).getTime() : 0;
    if (latest?.status === "RUNNING" && startedAt > 0 && Date.now() - startedAt > STUCK_STEP_MS) {
      log.warn({ runId: run.id, stepKey: latest.stepKey }, "stuck step detected; re-dispatching");
      await dispatchAdvance(run.id, run.organizationId);
    }
  }

  return NextResponse.json({
    id: run.id,
    workflow: run.workflow.key,
    status: run.status,
    currentStepKey: run.currentStepKey,
    costUsd: microToUsd(run.costMicroUsd),
    steps: run.stepRuns.map((s) => ({ stepKey: s.stepKey, status: s.status })),
    approvals: run.approvals,
    assets: run.assets,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
}
