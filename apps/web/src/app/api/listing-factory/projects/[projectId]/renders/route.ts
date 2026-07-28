import { prisma } from "@bf/database";
import { can, PlatformError, toErrorRecord } from "@bf/shared";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { startListingRender } from "@/lib/lvf-render";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 300;

const bodySchema = z.object({ kind: z.enum(["preview", "final"]).default("final") });

/**
 * Start a render via the API. API renders carry no browser-rasterized text
 * overlays — captions ship as the SRT sidecar instead.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!can(ctx.role, "workflows:execute")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!(await checkRateLimit(`lvf-render:${ctx.userId}`, 6, 60))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }
  const { projectId } = await params;
  let kind: "preview" | "final";
  try {
    kind = bodySchema.parse(await request.json().catch(() => ({}))).kind;
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  try {
    const { renderId } = await startListingRender({
      organizationId: ctx.organizationId,
      userId: ctx.userId,
      projectId,
      kind,
      overlays: [],
    });
    return NextResponse.json({ renderId }, { status: 202 });
  } catch (err) {
    if (err instanceof PlatformError) {
      const rec = toErrorRecord(err);
      return NextResponse.json(
        { error: rec.message, code: rec.code },
        { status: rec.code === "NOT_FOUND" ? 404 : rec.code === "CONFLICT" ? 409 : 400 },
      );
    }
    throw err;
  }
}

/** List renders for a project. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const renders = await prisma.listingRender.findMany({
    where: { projectId, organizationId: ctx.organizationId },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      kind: true,
      status: true,
      error: true,
      videoAssetId: true,
      createdAt: true,
    },
  });
  return NextResponse.json({ renders });
}
