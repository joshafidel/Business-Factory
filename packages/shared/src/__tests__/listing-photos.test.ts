import { describe, expect, it } from "vitest";
import { isSafePhotoUrl, MAX_LISTING_PHOTOS, parsePhotoUrls } from "../listing-photos";

describe("isSafePhotoUrl", () => {
  it.each([
    "https://photos.zillowstatic.com/fp/abc.jpg",
    "https://cdn.example.com/a/b/c.png?w=1200",
  ])("accepts %s", (url) => {
    expect(isSafePhotoUrl(url)).toBe(true);
  });

  it.each([
    "http://cdn.example.com/a.jpg", // not https
    "https://localhost/a.jpg",
    "https://foo.localhost/a.jpg",
    "https://internal.corp.internal/a.jpg",
    "https://10.0.0.5/a.jpg",
    "https://127.0.0.1/a.jpg",
    "https://169.254.169.254/latest/meta-data", // cloud metadata
    "https://172.16.0.1/a.jpg",
    "https://192.168.1.1/a.jpg",
    "https://[::1]/a.jpg",
    "https://user:pass@cdn.example.com/a.jpg",
    "https://cdn.example.com:8443/a.jpg", // non-443 port
    "not a url",
    "ftp://cdn.example.com/a.jpg",
  ])("rejects %s", (url) => {
    expect(isSafePhotoUrl(url)).toBe(false);
  });
});

describe("parsePhotoUrls", () => {
  it("splits on newlines and commas, dedupes, keeps order", () => {
    const { urls, rejected } = parsePhotoUrls(
      "https://a.example.com/1.jpg\nhttps://a.example.com/2.jpg, https://a.example.com/1.jpg\nhttp://bad.example.com/x.jpg",
    );
    expect(urls).toEqual(["https://a.example.com/1.jpg", "https://a.example.com/2.jpg"]);
    expect(rejected).toEqual(["http://bad.example.com/x.jpg"]);
  });

  it("caps at MAX_LISTING_PHOTOS", () => {
    const input = Array.from(
      { length: MAX_LISTING_PHOTOS + 3 },
      (_, i) => `https://x.example.com/${i}.jpg`,
    ).join("\n");
    const { urls, rejected } = parsePhotoUrls(input);
    expect(urls).toHaveLength(MAX_LISTING_PHOTOS);
    expect(rejected).toHaveLength(3);
  });
});
