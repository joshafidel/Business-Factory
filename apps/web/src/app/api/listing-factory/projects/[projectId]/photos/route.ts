import { prisma, type Prisma } from "@bf/database";
import { getStorage } from "@bf/storage";
import { can, parsePhotoUrls } from "@bf/shared";
import { MODULE_KEY } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import {
  attachListingPhotos,
  downloadListingPhotos,
  sniffImage,
  type IncomingPhoto,
} from "@/lib/lvf-photos";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 120;

/**
 * Photo + overlay upload for a Listing Video Factory project.
 *
 *  - multipart/form-data with `files`: validated (magic bytes, size, count),
 *    deduplicated by content hash, stored via the platform storage driver.
 *  - multipart with `kind=overlay`: stores a client-rasterized PNG overlay
 *    as an Asset only (no organizer row) and returns its id.
 *  - application/json `{ urls: [...] }`: imports photos the user already
 *    hosts elsewhere (https-only, private hosts blocked). No scraping — the
 *    user supplies direct image URLs they have rights to.
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
  if (!(await checkRateLimit(`lvf-upload:${ctx.userId}`, 30, 60))) {
    return NextResponse.json({ error: "Too many uploads — try again in a minute" }, { status: 429 });
  }
  const { projectId } = await params;
  const project = await prisma.listingProject.findFirst({
    where: { id: projectId, organizationId: ctx.organizationId },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const contentType = request.headers.get("content-type") ?? "";
  let incoming: IncomingPhoto[] = [];
  let isOverlay = false;
  let overlayRole = "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { urls?: string[] } | null;
    const { urls, rejected } = parsePhotoUrls((body?.urls ?? []).join("\n"));
    if (urls.length === 0) {
      return NextResponse.json(
        {
          error: rejected.length
            ? `No usable URLs (https-only). Rejected: ${rejected.length}`
            : "No URLs given",
        },
        { status: 400 },
      );
    }
    incoming = await downloadListingPhotos(urls);
  } else {
    const form = await request.formData();
    isOverlay = form.get("kind") === "overlay";
    overlayRole = String(form.get("role") ?? "");
    for (const value of form.getAll("files")) {
      if (value instanceof File) {
        incoming.push({
          name: value.name.replace(/[^\w.\-]/g, "_").slice(0, 100) || "photo",
          data: Buffer.from(await value.arrayBuffer()),
        });
      }
    }
  }
  if (incoming.length === 0) {
    return NextResponse.json({ error: "No files received" }, { status: 400 });
  }

  if (isOverlay) {
    const file = incoming[0]!;
    if (file.data.byteLength > 2 * 1024 * 1024 || sniffImage(file.data) !== "image/png") {
      return NextResponse.json({ error: "Overlays must be PNG under 2MB" }, { status: 400 });
    }
    const storage = getStorage();
    const key = `${ctx.organizationId}/${project.id}/overlay-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const stored = await storage.put(key, file.data, { contentType: "image/png" });
    const asset = await prisma.asset.create({
      data: {
        organizationId: ctx.organizationId,
        name: `Overlay (${overlayRole || "text"}): ${project.name}`.slice(0, 120),
        type: "IMAGE",
        mimeType: "image/png",
        storageDriver: storage.driver,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        moduleKey: MODULE_KEY,
        source: "upload:listing-factory:overlay",
        approvalStatus: "PENDING_REVIEW",
        metadata: { projectId: project.id, role: overlayRole || "overlay" } as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ assetId: asset.id });
  }

  const { created, skipped } = await attachListingPhotos(ctx.organizationId, project, incoming);
  return NextResponse.json({ created, skipped });
}
