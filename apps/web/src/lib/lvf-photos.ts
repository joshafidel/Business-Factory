import { createHash } from "node:crypto";
import { prisma, type Prisma } from "@bf/database";
import { getStorage } from "@bf/storage";
import { isSafePhotoUrl } from "@bf/shared";
import { LIMITS, MODULE_KEY, trackEvent } from "@bf/workflows";

/**
 * Listing Video Factory photo ingestion, shared by the upload API route and
 * the listing-page importer: magic-byte validation, size caps, content-hash
 * dedupe, Asset + ListingPhoto creation through the platform storage driver.
 */

export interface IncomingPhoto {
  name: string;
  data: Buffer;
}

export interface AttachResult {
  created: { id: string; assetId: string; name: string }[];
  skipped: { name: string; reason: string }[];
}

const SIGNATURES: { mime: string; match: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    mime: "image/png",
    match: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: "image/webp",
    match: (b) =>
      b.subarray(0, 4).toString("ascii") === "RIFF" &&
      b.subarray(8, 12).toString("ascii") === "WEBP",
  },
];

export function sniffImage(data: Buffer): string | null {
  for (const sig of SIGNATURES) if (sig.match(data)) return sig.mime;
  return null;
}

/** Download photos from already-validated https URLs; bad URLs are skipped. */
export async function downloadListingPhotos(urls: string[]): Promise<IncomingPhoto[]> {
  const incoming: IncomingPhoto[] = [];
  for (const url of urls.slice(0, LIMITS.maxPhotosPerProject)) {
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
  return incoming;
}

/** Validate, dedupe, store, and attach photos to a project (org-checked by caller). */
export async function attachListingPhotos(
  organizationId: string,
  project: { id: string; name: string; coverPhotoId: string | null },
  incoming: IncomingPhoto[],
): Promise<AttachResult> {
  const storage = getStorage();
  const existingCount = await prisma.listingPhoto.count({ where: { projectId: project.id } });
  if (existingCount + incoming.length > LIMITS.maxPhotosPerProject) {
    return {
      created: [],
      skipped: incoming.map((f) => ({
        name: f.name,
        reason: `A project holds at most ${LIMITS.maxPhotosPerProject} photos`,
      })),
    };
  }
  const existingHashes = new Set(
    (
      await prisma.asset.findMany({
        where: { listingPhotos: { some: { projectId: project.id } } },
        select: { metadata: true },
      })
    ).map((a) => (a.metadata as { contentHash?: string } | null)?.contentHash ?? ""),
  );

  const result: AttachResult = { created: [], skipped: [] };
  let order = existingCount;
  for (const file of incoming) {
    const mime = sniffImage(file.data);
    if (!mime) {
      result.skipped.push({ name: file.name, reason: "Not a JPG/PNG/WEBP image" });
      continue;
    }
    if (file.data.byteLength > LIMITS.maxPhotoBytes) {
      result.skipped.push({ name: file.name, reason: "Over the 8MB limit" });
      continue;
    }
    const contentHash = createHash("sha256").update(file.data).digest("hex");
    if (existingHashes.has(contentHash)) {
      result.skipped.push({ name: file.name, reason: "Duplicate of an existing photo" });
      continue;
    }
    existingHashes.add(contentHash);
    const key = `${organizationId}/${project.id}/photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const stored = await storage.put(key, file.data, { contentType: mime });
    const asset = await prisma.asset.create({
      data: {
        organizationId,
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
        organizationId,
        projectId: project.id,
        assetId: asset.id,
        order: order++,
        category: "interior",
      },
    });
    result.created.push({ id: photo.id, assetId: asset.id, name: file.name });
  }

  if (result.created.length > 0 && !project.coverPhotoId) {
    await prisma.listingProject.update({
      where: { id: project.id },
      data: { coverPhotoId: result.created[0]!.id },
    });
  }
  if (result.created.length > 0) {
    await trackEvent(organizationId, "lvf_photos_uploaded", result.created.length);
  }
  return result;
}
