import { loadEnv } from "@bf/config";
import { prisma } from "@bf/database";
import { verifyAssetToken } from "@bf/shared";
import { getStorage } from "@bf/storage";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Serves an asset's bytes to unauthenticated callers holding a valid
 * short-lived HMAC token (see signAssetToken). Used so external services
 * (e.g. Higgsfield's image fetcher) can download scene images by URL.
 * The token binds one asset id to one expiry; storage keys are never
 * accepted from the client.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const id = request.nextUrl.searchParams.get("id");
  const exp = Number(request.nextUrl.searchParams.get("exp"));
  const sig = request.nextUrl.searchParams.get("sig");
  if (!id || !sig || !Number.isFinite(exp)) {
    return NextResponse.json({ error: "Missing id/exp/sig" }, { status: 400 });
  }

  const env = loadEnv();
  if (!verifyAssetToken(env.SECRET_ENCRYPTION_KEY, id, exp, sig)) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 403 });
  }

  const asset = await prisma.asset.findUnique({ where: { id } });
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const storage = getStorage();
  if (storage.driver !== asset.storageDriver) {
    return NextResponse.json({ error: "Asset stored in a different backend" }, { status: 409 });
  }
  try {
    const data = await storage.get(asset.storageKey);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(data.length),
        "cache-control": "public, max-age=300",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Asset data unavailable" }, { status: 404 });
  }
}
