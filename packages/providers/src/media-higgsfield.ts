import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";

/**
 * Higgsfield image-to-video: animates a still image into a ~5s motion clip
 * (their "DoP" models). Used by Zoo Shorts to turn scene illustrations into
 * true animated shots instead of Ken Burns pans.
 *
 * API (platform.higgsfield.ai): POST /v1/image2video submits a job set,
 * GET /v1/job-sets/{id} polls it. Input images must be publicly fetchable
 * URLs (data URLs are rejected). Pricing ≈ $0.10 per second of video, so a
 * clip costs ~$0.55 — the renderer records this per completed clip.
 */
const HF_BASE = "https://platform.higgsfield.ai";

/**
 * Model tier (HIGGSFIELD_MODEL): dop-lite (default, cheap living-photo
 * motion), dop-preview, dop-turbo. One clip takes ~3-4 minutes on a quiet
 * queue; the account allows 4 concurrent jobs.
 */
function hfModel(): string {
  return loadEnv().HIGGSFIELD_MODEL ?? "dop-lite";
}

/**
 * Per-clip cost estimate by model tier. dop-lite ≈ $0.10/s; the premium
 * tiers are booked at 2x as a conservative estimate until real billing
 * numbers say otherwise.
 */
export function higgsfieldClipCostMicroUsd(): bigint {
  return hfModel() === "dop-lite" ? 550_000n : 1_100_000n;
}
/** @deprecated use higgsfieldClipCostMicroUsd() — kept for existing imports. */
export const HIGGSFIELD_CLIP_COST_MICRO_USD = 550_000n;

const log = createLogger("higgsfield");

export function higgsfieldConfigured(): boolean {
  const env = loadEnv();
  return Boolean(env.HIGGSFIELD_API_KEY && env.HIGGSFIELD_SECRET);
}

async function proxyDispatcher(): Promise<unknown> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return undefined;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxy);
}

async function hfFetch(path: string, init?: { method?: string; body?: string }): Promise<Response> {
  const env = loadEnv();
  return fetch(`${HF_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "hf-api-key": env.HIGGSFIELD_API_KEY ?? "",
      "hf-secret": env.HIGGSFIELD_SECRET ?? "",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    ...(init?.body ? { body: init.body } : {}),
    ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
  } as RequestInit);
}

export interface HiggsfieldJobSet {
  jobSetId: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled" | "unknown";
  videoUrl?: string;
}

/** Submit one image-to-video job. Throws on rejection (e.g. unreachable image URL). */
export async function submitImageToVideo(params: {
  imageUrl: string;
  prompt: string;
}): Promise<string> {
  const res = await hfFetch("/v1/image2video", {
    method: "POST",
    body: JSON.stringify({
      params: {
        model: hfModel(),
        prompt: params.prompt,
        input_images: [{ type: "image_url", image_url: params.imageUrl }],
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Higgsfield submit failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { id?: string };
  if (!data.id) throw new Error(`Higgsfield submit returned no job set id: ${text.slice(0, 200)}`);
  return data.id;
}

/** One poll of a job set. Never throws on transient errors — returns "unknown". */
export async function pollJobSet(jobSetId: string): Promise<HiggsfieldJobSet> {
  try {
    const res = await hfFetch(`/v1/job-sets/${jobSetId}`);
    if (!res.ok) return { jobSetId, status: "unknown" };
    const data = (await res.json()) as {
      jobs?: { status?: string; results?: { raw?: { url?: string }; min?: { url?: string } } }[];
    };
    const job = data.jobs?.[0];
    const status = (job?.status ?? "unknown") as HiggsfieldJobSet["status"];
    return {
      jobSetId,
      status,
      videoUrl: job?.results?.raw?.url ?? job?.results?.min?.url,
    };
  } catch (err) {
    log.warn({ jobSetId, err }, "higgsfield poll failed");
    return { jobSetId, status: "unknown" };
  }
}

/**
 * Wait for several job sets, bounded by a shared deadline. Returns whatever
 * finished in time; unfinished/failed entries simply lack a videoUrl (the
 * caller falls back to Ken Burns for those scenes).
 */
export async function awaitJobSets(
  jobSetIds: string[],
  deadlineMs: number,
  pollIntervalMs = 10_000,
): Promise<Map<string, HiggsfieldJobSet>> {
  const results = new Map<string, HiggsfieldJobSet>();
  const pending = new Set(jobSetIds);
  while (pending.size > 0 && Date.now() < deadlineMs) {
    const polled = await Promise.all([...pending].map((id) => pollJobSet(id)));
    for (const r of polled) {
      if (r.status === "completed" && r.videoUrl) {
        results.set(r.jobSetId, r);
        pending.delete(r.jobSetId);
      } else if (r.status === "failed" || r.status === "nsfw" || r.status === "canceled") {
        results.set(r.jobSetId, r);
        pending.delete(r.jobSetId);
        log.warn(
          { jobSetId: r.jobSetId, status: r.status },
          "higgsfield job did not produce video",
        );
      }
    }
    if (pending.size > 0) {
      await new Promise((r) =>
        setTimeout(r, Math.min(pollIntervalMs, Math.max(0, deadlineMs - Date.now()))),
      );
    }
  }
  for (const id of pending) results.set(id, { jobSetId: id, status: "unknown" });
  return results;
}

/** Download a finished clip from Higgsfield's CDN. */
export async function downloadClip(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
  } as RequestInit);
  if (!res.ok) throw new Error(`Higgsfield clip download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
