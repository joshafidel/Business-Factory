import { prisma } from "@bf/database";
import { getStorage } from "@bf/storage";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrgContext } from "@/lib/session";

export const maxDuration = 300;

/**
 * Storage maintenance (Owner/Admin only). The zero-config serverless setup
 * keeps media bytes in Postgres, so hosted plans with a DB size cap fill up
 * over time. GET reports usage; POST prunes strictly regenerable artifacts:
 *
 *  - preview render videos (one click to re-render)
 *  - text-overlay PNGs (rasterized fresh by the browser on every render)
 *  - cached voice-over lines (regenerated on demand for pennies)
 *  - pipeline intermediates (scene images/audio) from runs whose final
 *    video already exists — never final videos, never uploaded photos
 *  - orphaned blobs no Asset row references
 */

async function requireAdmin() {
  const ctx = await getOrgContext();
  if (!ctx) return null;
  if (!["OWNER", "ADMIN"].includes(ctx.role)) return null;
  return ctx;
}

export async function GET(): Promise<NextResponse> {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const byModule = await prisma.asset.groupBy({
    by: ["moduleKey", "type"],
    where: { organizationId: ctx.organizationId },
    _sum: { sizeBytes: true },
    _count: true,
  });
  const blobTotal = await prisma.storageBlob.aggregate({
    _sum: { sizeBytes: true },
    _count: true,
  });
  const [{ size }] = await prisma.$queryRawUnsafe<[{ size: bigint }]>(
    "SELECT pg_database_size(current_database()) AS size",
  );
  return NextResponse.json({
    databaseMb: Math.round(Number(size) / 1024 / 102.4) / 10,
    assets: byModule.map((r) => ({
      moduleKey: r.moduleKey,
      type: r.type,
      count: r._count,
      mb: Math.round((r._sum.sizeBytes ?? 0) / 1024 / 102.4) / 10,
    })),
    blobs: {
      count: blobTotal._count,
      mb: Math.round((blobTotal._sum.sizeBytes ?? 0) / 1024 / 102.4) / 10,
    },
  });
}

const pruneSchema = z.object({
  previews: z.boolean().default(false),
  overlays: z.boolean().default(false),
  voiceCache: z.boolean().default(false),
  intermediates: z.boolean().default(false),
  orphans: z.boolean().default(false),
  /** Run VACUUM so deleted blob pages are returned to the size quota. */
  vacuum: z.boolean().default(false),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const ctx = await requireAdmin();
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const opts = pruneSchema.parse(await request.json().catch(() => ({})));
  const storage = getStorage();
  let freedBytes = 0;
  let deleted = 0;

  const deleteAssets = async (ids: string[]): Promise<void> => {
    for (const id of ids) {
      const asset = await prisma.asset.findUnique({ where: { id } });
      if (!asset) continue;
      // Photos in active use are protected by FK cascade semantics: skip any
      // asset still referenced by a listing photo.
      const inUse = await prisma.listingPhoto.count({ where: { assetId: id } });
      if (inUse > 0) continue;
      await storage.delete(asset.storageKey).catch(() => undefined);
      await prisma.asset.delete({ where: { id } }).catch(() => undefined);
      freedBytes += asset.sizeBytes;
      deleted += 1;
    }
  };

  if (opts.previews) {
    const previews = await prisma.listingRender.findMany({
      where: { organizationId: ctx.organizationId, kind: "PREVIEW", videoAssetId: { not: null } },
      select: { id: true, videoAssetId: true },
    });
    await deleteAssets(previews.map((p) => p.videoAssetId!));
    await prisma.listingRender.updateMany({
      where: { id: { in: previews.map((p) => p.id) } },
      data: { videoAssetId: null },
    });
  }
  if (opts.overlays) {
    const overlays = await prisma.asset.findMany({
      where: { organizationId: ctx.organizationId, source: "upload:listing-factory:overlay" },
      select: { id: true },
    });
    await deleteAssets(overlays.map((o) => o.id));
  }
  if (opts.voiceCache) {
    const voices = await prisma.asset.findMany({
      where: {
        organizationId: ctx.organizationId,
        type: "AUDIO",
        source: "workflow:listing-factory-render:prepare",
      },
      select: { id: true },
    });
    await deleteAssets(voices.map((v) => v.id));
  }
  if (opts.intermediates) {
    // Zoo pipeline scene images + audio for runs whose final video exists.
    const runsWithVideo = await prisma.asset.findMany({
      where: {
        organizationId: ctx.organizationId,
        moduleKey: "kids-shorts",
        type: "VIDEO",
        workflowRunId: { not: null },
      },
      select: { workflowRunId: true },
    });
    const runIds = [...new Set(runsWithVideo.map((r) => r.workflowRunId!))];
    const intermediates = await prisma.asset.findMany({
      where: {
        organizationId: ctx.organizationId,
        moduleKey: "kids-shorts",
        type: { in: ["IMAGE", "AUDIO"] },
        workflowRunId: { in: runIds },
      },
      select: { id: true },
    });
    await deleteAssets(intermediates.map((i) => i.id));
  }
  if (opts.orphans && storage.driver === "db") {
    // Blobs no Asset references (crashed runs, superseded writes).
    const keys = await prisma.storageBlob.findMany({ select: { key: true, sizeBytes: true } });
    const referenced = new Set(
      (await prisma.asset.findMany({ select: { storageKey: true } })).map((a) => a.storageKey),
    );
    for (const blob of keys) {
      if (referenced.has(blob.key)) continue;
      await prisma.storageBlob.delete({ where: { key: blob.key } }).catch(() => undefined);
      freedBytes += blob.sizeBytes;
      deleted += 1;
    }
  }

  let vacuumed = false;
  if (opts.vacuum) {
    // VACUUM can't run inside a transaction — send as a plain statement.
    // Regular vacuum (not FULL): frees dead pages for reuse and truncates
    // trailing empty pages back to the hosting plan's size quota.
    await prisma.$executeRawUnsafe('VACUUM "StorageBlob"');
    await prisma.$executeRawUnsafe("VACUUM");
    vacuumed = true;
  }
  const [{ size }] = await prisma.$queryRawUnsafe<[{ size: bigint }]>(
    "SELECT pg_database_size(current_database()) AS size",
  );
  return NextResponse.json({
    deleted,
    freedMb: Math.round(freedBytes / 1024 / 102.4) / 10,
    vacuumed,
    databaseMb: Math.round(Number(size) / 1024 / 102.4) / 10,
  });
}
