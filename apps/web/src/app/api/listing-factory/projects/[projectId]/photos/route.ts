import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@bf/database";
import { getStorage } from "@bf/storage";
import { can, isSafePhotoUrl, parsePhotoUrls } from "@bf/shared";
import { LIMITS, MODULE_KEY, trackEvent } from "@bf/workflows";
import { NextResponse, type NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 120;

/**
 * Photo + overlay upload for a Listing Video Factory project.
 *
 *  - multipart/form-data with `files`: validated (magic bytes, size, count),
 *    deduplicated by content hash, stored via the platform storage driver as
 *    Asset rows + ListingPhoto organizer rows.
 *  - multipart with `kind=overlay`: stores a client-rasterized PNG overlay
 *    as an Asset only (no organizer row) and returns its id.
 *  - application/json `{ urls: [...] }`: imports photos the agent already
 *    hosts elsewhere (https-only, private hosts blocked — see
 *    isSafePhotoUrl). No scraping: the user supplies direct image URLs they
 *    have rights to.
 */

const SIGNATURES: { mime: string; match: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    match: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    match: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

function sniffImage(data: Buffer): string | null {
  for (const sig of SIGNATURES) if (sig.match(data)) return sig.mime;
  return null;
}

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
  const incoming: { name: string; data: Buffer }[] = [];
  let isOverlay = false;
  let overlayRole = "";

  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { urls?: string[] } | null;
    const { urls, rejected } = parsePhotoUrls((body?.urls ?? []).join("\n"));
    if (urls.length === 0) {
      return NextResponse.json(
        { error: rejected.length ? `No usable URLs (https-only). Rejected: ${rejected.length}` : "No URLs given" },
        { status: 400 },
      );
    }
    for (const url of urls) {
      if (!isSafePhotoUrl(url)) continue;
      try {
        const res = await fetch(url, {
          redirect: "follow",
          signal: AbortSignal.timeout(20_000),
          headers: { accept: "image/*" },
        });
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = Buffer.from(await res.arrayBuffer());
        incoming.push({ name: new URL(url).pathname.split("/").pop() || "photo", data });
      } catch {
        // Skip a bad URL rather than failing the batch.
      }
    }
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

  const storage = getStorage();

  if (isOverlay) {
    const file = incoming[0]!;
    if (file.data.byteLength > 2 * 1024 * 1024 || sniffImage(file.data) !== "image/png") {
      return NextResponse.json({ error: "Overlays must be PNG under 2MB" }, { status: 400 });
    }
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

  const existingCount = await prisma.listingPhoto.count({ where: { projectId: project.id } });
  if (existingCount + incoming.length > LIMITS.maxPhotosPerProject) {
    return NextResponse.json(
      { error: `A project holds at most ${LIMITS.maxPhotosPerProject} photos` },
      { status: 400 },
    );
  }
  const existingHashes = new Set(
    (
      await prisma.asset.findMany({
        where: { listingPhotos: { some: { projectId: project.id } } },
        select: { metadata: true },
      })
    ).map((a) => (a.metadata as { contentHash?: string } | null)?.contentHash ?? ""),
  );

  const created: { id: string; assetId: string; name: string }[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let order = existingCount;
  for (const file of incoming) {
    const mime = sniffImage(file.data);
    if (!mime) {
      skipped.push({ name: file.name, reason: "Not a JPG/PNG/WEBP image" });
      continue;
    }
    if (file.data.byteLength > LIMITS.maxPhotoBytes) {
      skipped.push({ name: file.name, reason: "Over the 8MB limit" });
      continue;
    }
    const contentHash = createHash("sha256").update(file.data).digest("hex");
    if (existingHashes.has(contentHash)) {
      skipped.push({ name: file.name, reason: "Duplicate of an existing photo" });
      continue;
    }
    existingHashes.add(contentHash);
    const key = `${ctx.organizationId}/${project.id}/photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored = await storage.put(key, file.data, { contentType: mime });
    const asset = await prisma.asset.create({
      data: {
        organizationId: ctx.organizationId,
        name: `Listing photo: ${file.name}`.slice(0, 120),
        type: "IMAGE",
        mimeType: mime,
        storageDriver: storage.driver,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        moduleKey: MODULE_KEY,
        source: "upload:listing-factory",
        approvalStatus: "PENDING_REVIEW",
        metadata: { projectId: project.id, contentHash } as Prisma.InputJsonValue,
      },
    });
    const photo = await prisma.listingPhoto.create({
      data: {
        organizationId: ctx.organizationId,
        projectId: project.id,
        assetId: asset.id,
        order: order++,
        category: "interior",
      },
    });
    created.push({ id: photo.id, assetId: asset.id, name: file.name });
  }

  if (created.length > 0 && !project.coverPhotoId) {
    await prisma.listingProject.update({
      where: { id: project.id },
      data: { coverPhotoId: created[0]!.id },
    });
  }
  if (created.length > 0) await trackEvent(ctx.organizationId, "lvf_photos_uploaded", created.length);
  return NextResponse.json({ created, skipped });
}
