import { describe, expect, it } from "vitest";
import { signAssetToken, verifyAssetToken } from "../signed-url";

const SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("signed asset tokens", () => {
  it("round-trips a valid token", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signAssetToken(SECRET, "asset-1", exp);
    expect(verifyAssetToken(SECRET, "asset-1", exp, sig)).toBe(true);
  });

  it("rejects a tampered asset id", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signAssetToken(SECRET, "asset-1", exp);
    expect(verifyAssetToken(SECRET, "asset-2", exp, sig)).toBe(false);
  });

  it("rejects an expired token", () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const sig = signAssetToken(SECRET, "asset-1", exp);
    expect(verifyAssetToken(SECRET, "asset-1", exp, sig)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const exp = Math.floor(Date.now() / 1000) + 60;
    const sig = signAssetToken(SECRET, "asset-1", exp);
    expect(verifyAssetToken(SECRET.replace("0", "f"), "asset-1", exp, sig)).toBe(false);
  });
});
