import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";

const log = createLogger("lvf-feeds");

/**
 * Licensed MLS listing feeds — the lawful way to source real listings
 * (Zillow itself displays MLS data; there is no public Zillow API). The
 * first provider is SimplyRETS: real MLS/IDX feeds authorized by an agent
 * or broker, exposed as a clean REST API. Without credentials the public
 * SimplyRETS sample feed is used and flagged `isDemo` so the UI can label
 * it — the moment licensed credentials land in the env, the same code path
 * serves real active listings.
 */

export interface FeedListing {
  mlsId: string;
  listingId: string;
  status: string;
  address: string;
  city: string;
  state: string;
  price: string;
  beds: string;
  baths: string;
  sqft: string;
  description: string;
  photos: string[];
  agentName: string;
  agentPhone: string;
  agentEmail: string;
  brokerage: string;
}

export interface ListingFeedProvider {
  readonly key: string;
  /** True when serving the sample feed (no licensed credentials set). */
  readonly isDemo: boolean;
  searchListings(params: { q?: string; limit?: number }): Promise<FeedListing[]>;
  getListing(mlsId: string): Promise<FeedListing | null>;
}

const SIMPLYRETS_BASE = "https://api.simplyrets.com";

async function proxyDispatcher(): Promise<unknown> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return undefined;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxy);
}

/** Map a SimplyRETS property record into our feed shape (pure, tested). */
export function mapSimplyRetsListing(record: Record<string, unknown>): FeedListing {
  const address = (record.address ?? {}) as Record<string, unknown>;
  const property = (record.property ?? {}) as Record<string, unknown>;
  const agent = (record.agent ?? {}) as Record<string, unknown>;
  const contact = (agent.contact ?? {}) as Record<string, unknown>;
  const office = (record.office ?? {}) as Record<string, unknown>;
  const mls = (record.mls ?? {}) as Record<string, unknown>;
  const str = (v: unknown): string => (v == null ? "" : String(v));
  const price = Number(record.listPrice);
  const bathsFull = Number(property.bathsFull ?? 0) || 0;
  const bathsHalf = Number(property.bathsHalf ?? 0) || 0;
  const baths = Number(property.bathrooms) || bathsFull + (bathsHalf > 0 ? 0.5 : 0);
  return {
    mlsId: str(record.mlsId),
    listingId: str(record.listingId),
    status: str(mls.status || "Active"),
    address: str(address.full),
    city: str(address.city),
    state: str(address.state),
    price: Number.isFinite(price) && price > 0 ? `$${price.toLocaleString("en-US")}` : "",
    beds: str(property.bedrooms ?? ""),
    baths: baths > 0 ? String(baths) : "",
    sqft: property.area ? Number(property.area).toLocaleString("en-US") : "",
    description: str(record.remarks).slice(0, 4000),
    photos: Array.isArray(record.photos)
      ? record.photos.filter((p): p is string => typeof p === "string")
      : [],
    agentName: [agent.firstName, agent.lastName].map(str).filter(Boolean).join(" "),
    agentPhone: str(contact.cell || contact.office),
    agentEmail: str(contact.email),
    brokerage: str(office.name ?? ""),
  };
}

class SimplyRetsFeed implements ListingFeedProvider {
  readonly key = "simplyrets";
  readonly isDemo: boolean;
  private readonly auth: string;

  constructor(username: string, password: string, isDemo: boolean) {
    this.auth = Buffer.from(`${username}:${password}`).toString("base64");
    this.isDemo = isDemo;
  }

  private async fetchJson(path: string): Promise<unknown> {
    const res = await fetch(`${SIMPLYRETS_BASE}${path}`, {
      headers: { authorization: `Basic ${this.auth}`, accept: "application/json" },
      signal: AbortSignal.timeout(20_000),
      ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
    } as RequestInit);
    if (!res.ok) {
      throw new Error(`SimplyRETS ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    }
    return res.json();
  }

  async searchListings(params: { q?: string; limit?: number }): Promise<FeedListing[]> {
    const search = new URLSearchParams({
      status: "Active",
      limit: String(Math.min(25, Math.max(1, params.limit ?? 12))),
    });
    if (params.q?.trim()) search.set("q", params.q.trim().slice(0, 100));
    const data = await this.fetchJson(`/properties?${search.toString()}`);
    if (!Array.isArray(data)) return [];
    return data
      .map((r) => mapSimplyRetsListing(r as Record<string, unknown>))
      .filter((l) => l.address && l.photos.length > 0);
  }

  async getListing(mlsId: string): Promise<FeedListing | null> {
    if (!/^[\w-]+$/.test(mlsId)) return null;
    try {
      const data = await this.fetchJson(`/properties/${encodeURIComponent(mlsId)}`);
      return mapSimplyRetsListing(data as Record<string, unknown>);
    } catch (err) {
      log.warn({ mlsId, err }, "feed listing lookup failed");
      return null;
    }
  }
}

/** The configured feed; sample feed (flagged) when no credentials are set. */
export function getListingFeed(): ListingFeedProvider {
  const env = loadEnv();
  if (env.SIMPLYRETS_USERNAME && env.SIMPLYRETS_PASSWORD) {
    return new SimplyRetsFeed(env.SIMPLYRETS_USERNAME, env.SIMPLYRETS_PASSWORD, false);
  }
  return new SimplyRetsFeed("simplyrets", "simplyrets", true);
}
