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
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": asset.mimeType,
        "content-disposition": `inline; filename="${encodeURIComponent(asset.name)}"`,
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset data unavailable" }, { status: 404 });
  }
}
