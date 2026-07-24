import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC tokens for short-lived public asset URLs. Used to let external
 * services (e.g. Higgsfield's image fetcher) download a specific asset
 * without a session, without exposing the storage key, and only until the
 * embedded expiry passes. Pure functions — the caller supplies the secret.
 */
export function signAssetToken(secret: string, assetId: string, expEpochSeconds: number): string {
  return createHmac("sha256", secret).update(`asset:${assetId}:${expEpochSeconds}`).digest("hex");
}

export function verifyAssetToken(
  secret: string,
  assetId: string,
  expEpochSeconds: number,
  signature: string,
): boolean {
  if (!Number.isFinite(expEpochSeconds) || expEpochSeconds * 1000 < Date.now()) return false;
  const expected = signAssetToken(secret, assetId, expEpochSeconds);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
