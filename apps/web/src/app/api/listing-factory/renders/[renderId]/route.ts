import { prisma } from "@bf/database";
import { syncActiveRenders } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/session";

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
