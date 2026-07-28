import { prisma } from "@bf/database";
import { createLogger } from "@bf/shared";
import { syncActiveRenders } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { dispatchAdvance } from "@/lib/execution";
import { getOrgContext } from "@/lib/session";

const log = createLogger("web:lvf-renders-api");

/** A step stuck RUNNING this long means its invocation died (timeout/OOM)
 *  before recording an outcome — nothing will advance the run on its own. */
const STUCK_STEP_MS = 7 * 60_000;

/** Live render status for the editor's polling loop. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ renderId: string }> },
): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { renderId } = await params;
  const render = await prisma.listingRender.findFirst({
    where: { id: renderId, organizationId: ctx.organizationId },
    include: { workflowRun: { select: { status: true, currentStepKey: true } } },
  });
  if (!render) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (render.status === "QUEUED" || render.status === "RUNNING") {
    await syncActiveRenders(render.projectId);
    // Self-healing (mirrors /api/runs/[id]): this endpoint is polled while
    // renders execute — detect a step whose invocation died without
    // recording an outcome and re-dispatch so the engine retries it.
    if (render.workflowRunId) {
      const latestStep = await prisma.stepRun.findFirst({
        where: { workflowRunId: render.workflowRunId },
        orderBy: { createdAt: "desc" },
        select: { stepKey: true, status: true, startedAt: true },
      });
      const startedAt = latestStep?.startedAt ? latestStep.startedAt.getTime() : 0;
      if (
        latestStep?.status === "RUNNING" &&
        startedAt > 0 &&
        Date.now() - startedAt > STUCK_STEP_MS
      ) {
        log.warn(
          { renderId: render.id, stepKey: latestStep.stepKey },
          "stuck step detected; re-dispatching",
        );
        await dispatchAdvance(render.workflowRunId, render.organizationId);
      }
    }
  }
  const fresh = await prisma.listingRender.findUnique({
    where: { id: render.id },
    include: { workflowRun: { select: { status: true, currentStepKey: true } } },
  });
  const stage =
    fresh!.status === "COMPLETED"
      ? "complete"
      : fresh!.status === "FAILED"
        ? "failed"
        : (fresh!.workflowRun?.currentStepKey ?? "queued");
  return NextResponse.json({
    id: fresh!.id,
    status: fresh!.status,
    stage,
    error: fresh!.error,
    videoAssetId: fresh!.videoAssetId,
  });
}
