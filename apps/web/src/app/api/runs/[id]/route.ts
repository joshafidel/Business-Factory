import { prisma } from "@bf/database";
import { can, microToUsd } from "@bf/shared";
import { NextResponse } from "next/server";
import { getOrgContext } from "@/lib/session";

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
      stepRuns: { orderBy: { createdAt: "asc" }, select: { stepKey: true, status: true } },
      approvals: { select: { id: true, status: true, title: true } },
      assets: { select: { id: true, name: true, approvalStatus: true } },
    },
  });
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    id: run.id,
    workflow: run.workflow.key,
    status: run.status,
    currentStepKey: run.currentStepKey,
    costUsd: microToUsd(run.costMicroUsd),
    steps: run.stepRuns,
    approvals: run.approvals,
    assets: run.assets,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  });
}
