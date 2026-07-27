/**
 * Listing photo URL handling for the real-estate module. Photo URLs are
 * user-supplied and fetched server-side, so parsing and safety checks live
 * here as pure functions the UI, workflow input schema, and renderer all
 * share.
 */

export const MAX_LISTING_PHOTOS = 12;

/** Hosts that must never be fetched server-side (SSRF). */
function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // IPv6 literals (URL keeps the brackets).
  if (host.startsWith("[")) return true;
  // IPv4 literals in loopback / private / link-local / metadata ranges.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
  }
  return false;
}

/** True when a single URL is acceptable as a listing photo source. */
export function isSafePhotoUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  return !isForbiddenHost(url.hostname);
}

export interface ParsedPhotoUrls {
  /** Valid, deduplicated URLs, capped at MAX_LISTING_PHOTOS, input order kept. */
  urls: string[];
  /** Entries that were dropped (invalid, unsafe, or over the cap). */
  rejected: string[];
}

/** Parse a pasted block of photo URLs (one per line, or comma-separated). */
export function parsePhotoUrls(raw: string): ParsedPhotoUrls {
  const urls: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/[\n,]+/)) {
    const candidate = piece.trim();
    if (!candidate) continue;
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!isSafePhotoUrl(candidate)) {
      rejected.push(candidate);
    } else if (urls.length >= MAX_LISTING_PHOTOS) {
      rejected.push(candidate);
    } else {
      urls.push(candidate);
    }
  }
  return { urls, rejected };
}
