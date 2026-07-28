import { isSafePhotoUrl, MAX_LISTING_PHOTOS } from "@bf/shared";

/**
 * Listing-page extraction: given the HTML of a page the user has confirmed
 * they may use (their own listing page — this is a single authorized fetch,
 * not a crawler), pull out the property facts, the listing agent, and the
 * photo URLs from structured data:
 *
 *  1. schema.org JSON-LD (RealEstateListing / Residence / Product / Offer /
 *     RealEstateAgent) — the lingua franca of listing pages and agent sites.
 *  2. Open Graph meta tags as fallback (og:image, og:title, og:description).
 *
 * Pure function → unit-testable; fetching happens at the caller.
 */

export interface ExtractedListing {
  property: {
    address?: string;
    price?: string;
    beds?: string;
    baths?: string;
    sqft?: string;
    description?: string;
    agentName?: string;
    brokerage?: string;
    agentPhone?: string;
    agentEmail?: string;
    listingUrl?: string;
  };
  photoUrls: string[];
  /** Page title (og:title fallback) usable as a project name. */
  title?: string;
}

type JsonNode = Record<string, unknown>;

function parseJsonLdBlocks(html: string): JsonNode[] {
  const nodes: JsonNode[] = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    try {
      const parsed = JSON.parse(match[1]!.trim()) as unknown;
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        if (root && typeof root === "object") {
          const node = root as JsonNode;
          nodes.push(node);
          const graph = node["@graph"];
          if (Array.isArray(graph)) {
            for (const g of graph) if (g && typeof g === "object") nodes.push(g as JsonNode);
          }
        }
      }
    } catch {
      // malformed block — skip
    }
  }
  return nodes;
}

function typeOf(node: JsonNode): string[] {
  const t = node["@type"];
  if (typeof t === "string") return [t];
  if (Array.isArray(t)) return t.filter((x): x is string => typeof x === "string");
  return [];
}

const LISTING_TYPES = new Set([
  "RealEstateListing",
  "Residence",
  "House",
  "SingleFamilyResidence",
  "Apartment",
  "ApartmentComplex",
  "Product",
  "Offer",
  "Place",
]);
const AGENT_TYPES = new Set([
  "RealEstateAgent",
  "Agent",
  "Person",
  "Organization",
  "LocalBusiness",
]);

function str(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return undefined;
}

function stripTags(v: string | undefined): string | undefined {
  return v
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);
}

function addressOf(node: JsonNode): string | undefined {
  const addr = node.address;
  if (typeof addr === "string") return addr.trim();
  if (addr && typeof addr === "object") {
    const a = addr as JsonNode;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode]
      .map(str)
      .filter(Boolean);
    if (parts.length) return parts.join(", ");
  }
  return undefined;
}

function priceOf(node: JsonNode): string | undefined {
  const offers = node.offers && typeof node.offers === "object" ? (node.offers as JsonNode) : node;
  const raw = str(offers.price) ?? str(node.price);
  if (!raw) return undefined;
  if (/[$€£]/.test(raw)) return raw;
  const num = Number(raw.replace(/[,\s]/g, ""));
  const currency = str(offers.priceCurrency) ?? "USD";
  if (!Number.isFinite(num) || num <= 0) return raw;
  const symbol =
    currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : `${currency} `;
  return `${symbol}${num.toLocaleString("en-US")}`;
}

function imagesOf(node: JsonNode): string[] {
  const out: string[] = [];
  const collect = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) for (const item of v) collect(item);
    else if (v && typeof v === "object") {
      const o = v as JsonNode;
      collect(o.url ?? o.contentUrl);
    }
  };
  collect(node.image);
  collect(node.photo);
  return out;
}

function agentOf(nodes: JsonNode[]): {
  agentName?: string;
  brokerage?: string;
  agentPhone?: string;
  agentEmail?: string;
} {
  // Dedicated agent node, or an agent/seller/provider hanging off a listing.
  const candidates: JsonNode[] = [];
  for (const node of nodes) {
    if (typeOf(node).some((t) => AGENT_TYPES.has(t)) && str(node.name)) candidates.push(node);
    for (const key of ["agent", "seller", "provider", "broker"]) {
      const v = node[key];
      if (v && typeof v === "object") candidates.push(v as JsonNode);
    }
  }
  for (const c of candidates) {
    const name = str(c.name);
    if (!name) continue;
    const worksFor =
      c.worksFor && typeof c.worksFor === "object" ? (c.worksFor as JsonNode) : undefined;
    const isOrg = typeOf(c).includes("Organization") || typeOf(c).includes("LocalBusiness");
    return {
      agentName: isOrg ? undefined : name,
      brokerage: str(worksFor?.name) ?? (isOrg ? name : undefined),
      agentPhone: str(c.telephone),
      agentEmail: str(c.email)?.replace(/^mailto:/i, ""),
    };
  }
  return {};
}

function metaContent(html: string, property: string): string[] {
  const out: string[] = [];
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property.replace(":", "\\:")}["'][^>]*>`,
    "gi",
  );
  for (const match of html.matchAll(re)) {
    const content = match[0].match(/content=["']([^"']+)["']/i);
    if (content?.[1]) out.push(content[1]);
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

/**
 * Portal listing URLs carry the address in the URL itself — no page fetch
 * needed. Parses Zillow (/homedetails/255-S-Rengstorff-Ave-APT-161-Mountain-
 * View-CA-94040/…), Realtor.com (…-detail/Street_City_ST_ZIP_M…), and
 * similar dash/underscore slugs. Returns null when no address-like slug is
 * found.
 */
export function parsePortalAddress(
  url: string,
): { address: string; city: string; state: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/").filter(Boolean);
  // Zillow: the segment after /homedetails/; Realtor.com: segment after
  // …-detail/; otherwise the longest dashed segment that starts with a number.
  let slug =
    segments[segments.indexOf("homedetails") + 1] ??
    segments.find((s) => /-detail$/.test(segments[segments.indexOf(s) - 1] ?? ""));
  if (!slug || segments.indexOf("homedetails") === -1) {
    slug = segments
      .filter((s) => /^\d+[-_]/.test(s) && (s.match(/[-_]/g)?.length ?? 0) >= 3)
      .sort((a, b) => b.length - a.length)[0];
  }
  if (!slug) return null;
  // Realtor.com uses underscores between address parts and a _M… suffix.
  const words = slug
    .replace(/_M\d[\d-]*$/i, "")
    .replace(/_/g, "-")
    .split("-")
    .filter(Boolean);
  if (words.length < 4) return null;
  // Expect: … City… ST ZIP  (ST = 2-letter state, ZIP = 5 digits at the end).
  let zip = "";
  if (/^\d{5}(\d{4})?$/.test(words[words.length - 1]!)) zip = words.pop()!;
  const stateWord = words[words.length - 1];
  if (!stateWord || !/^[A-Za-z]{2}$/.test(stateWord)) return null;
  const state = words.pop()!.toUpperCase();
  if (words.length < 2) return null;
  // Street/city boundary is ambiguous in a flat slug — keep the street as-is
  // and take up to the last two words as a best-effort city for the form.
  const city = words
    .slice(-2)
    .join(" ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  const street = words.join(" ");
  const address = `${street}, ${state}${zip ? ` ${zip}` : ""}`;
  return { address, city, state };
}

export function extractListingData(html: string, pageUrl: string): ExtractedListing {
  const nodes = parseJsonLdBlocks(html);
  const listingNodes = nodes.filter((n) => typeOf(n).some((t) => LISTING_TYPES.has(t)));
  const primary = listingNodes[0];

  const property: ExtractedListing["property"] = { listingUrl: pageUrl };
  const photoCandidates: string[] = [];

  if (primary) {
    property.address = addressOf(primary);
    property.price = priceOf(primary);
    property.beds = str(primary.numberOfBedrooms) ?? str(primary.numberOfRooms);
    property.baths = str(primary.numberOfBathroomsTotal) ?? str(primary.numberOfFullBathrooms);
    const floor = primary.floorSize;
    if (floor && typeof floor === "object") property.sqft = str((floor as JsonNode).value);
    property.description = stripTags(str(primary.description));
  }
  for (const node of listingNodes) photoCandidates.push(...imagesOf(node));
  Object.assign(property, agentOf(nodes));

  // Open Graph fallbacks.
  const ogTitle = metaContent(html, "og:title")[0];
  if (!property.address && ogTitle) property.address = decodeEntities(ogTitle).slice(0, 200);
  if (!property.description) {
    const ogDesc = metaContent(html, "og:description")[0];
    if (ogDesc) property.description = stripTags(decodeEntities(ogDesc));
  }
  photoCandidates.push(
    ...metaContent(html, "og:image"),
    ...metaContent(html, "og:image:secure_url"),
  );

  // Resolve, filter (https-only public hosts), dedupe, cap.
  const photoUrls: string[] = [];
  const seen = new Set<string>();
  for (const raw of photoCandidates) {
    let resolved: string;
    try {
      resolved = new URL(decodeEntities(raw), pageUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(resolved) || !isSafePhotoUrl(resolved)) continue;
    seen.add(resolved);
    photoUrls.push(resolved);
    if (photoUrls.length >= MAX_LISTING_PHOTOS) break;
  }

  return {
    property,
    photoUrls,
    title: ogTitle ? decodeEntities(ogTitle).slice(0, 120) : property.address,
  };
}
