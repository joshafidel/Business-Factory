import { prisma } from "@bf/database";
import { can } from "@bf/shared";
import { generateListingScript, trackEvent } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 300;

/** Generate (or regenerate) the tour script for a project via the API. */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "agents:execute")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkRateLimit(`lvf-script:${ctx.userId}`, 10, 60))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const { projectId } = await params;
  const project = await prisma.listingProject.findFirst({
    where: { id: projectId, organizationId: ctx.organizationId },
    select: { id: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  try {
    const { script, warnings } = await generateListingScript({
      organizationId: ctx.organizationId,
      projectId,
    });
    await trackEvent(ctx.organizationId, "lvf_scripts_generated");
    return NextResponse.json({ script, warnings });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message?.slice(0, 300) }, { status: 400 });
  }
}
