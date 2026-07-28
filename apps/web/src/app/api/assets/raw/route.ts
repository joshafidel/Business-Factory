import { prisma } from "@bf/database";
import { getStorage } from "@bf/storage";
import { NextResponse, type NextRequest } from "next/server";
import { getOrgContext } from "@/lib/session";

/**
 * Streams an asset's bytes after an auth + org check. Only assets belonging
 * to the caller's organization are served; the storage key itself is never
 * accepted from the client (id lookup only) to prevent path probing.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const ctx = await getOrgContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const asset = await prisma.asset.findFirst({
    where: { id, organizationId: ctx.organizationId },
  });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const storage = getStorage();
  if (storage.driver !== asset.storageDriver) {
    // Asset was written by a different driver (e.g. s3) — redirect to a signed URL.
    return NextResponse.json({ error: "Asset stored in a different backend" }, { status: 409 });
  }
  try {
    const data = await storage.get(asset.storageKey);
    const baseHeaders: Record<string, string> = {
      "content-type": asset.mimeType,
      "content-disposition": `inline; filename="${encodeURIComponent(asset.name)}"`,
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
      "accept-ranges": "bytes",
    };
    // HTTP Range support: video playback needs 206 partial responses to
    // stream and scrub (and keeps each response small enough that large
    // MP4s aren't truncated by response-size limits).
    const range = request.headers.get("range");
    const match = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] || match[2])) {
      const size = data.byteLength;
      let start = match[1] ? Number(match[1]) : size - Number(match[2]);
      let end = match[1] && match[2] ? Number(match[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end || start >= size) {
        return new NextResponse(null, {
          status: 416,
          headers: { "content-range": `bytes */${size}` },
        });
      }
      // Cap chunks so a single 206 stays well inside function response limits.
      end = Math.min(end, start + 4 * 1024 * 1024 - 1);
      return new NextResponse(new Uint8Array(data.subarray(start, end + 1)), {
        status: 206,
        headers: {
          ...baseHeaders,
          "content-range": `bytes ${start}-${end}/${size}`,
          "content-length": String(end - start + 1),
        },
      });
    }
    return new NextResponse(new Uint8Array(data), {
      headers: { ...baseHeaders, "content-length": String(data.byteLength) },
    });
  } catch {
    return NextResponse.json({ error: "Asset data unavailable" }, { status: 404 });
  }
}
