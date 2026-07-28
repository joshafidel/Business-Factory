import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";
import { type MediaResult } from "./media";

const log = createLogger("picsart");

/**
 * Picsart GenAI adapters (Listing Video Factory, optional). Verified against
 * the current docs (docs.picsart.io):
 *
 *  - POST https://genai-api.picsart.io/v1/image2video
 *    header `X-Picsart-API-Key`; body { image_url | image, prompt, model,
 *    quality, length, width, height, audio } → 202 with an inference id.
 *  - GET  https://genai-api.picsart.io/v1/video/{inference_id}
 *    202 while processing, 200 when finished.
 *
 * The finished-response schema isn't published, so `checkGenerationStatus`
 * parses the common Picsart GenAI result shapes defensively. Absent key =
 * provider absent; nothing else breaks.
 */

const PICSART_GENAI_BASE = "https://genai-api.picsart.io/v1";
/** Verified model URN (Seedance 1.5 Pro image-to-video); override via env. */
const DEFAULT_VIDEO_MODEL = "urn:air:seedance:model:seedance:seedance-1.5-pro-image-to-video@1";

/** Honor HTTPS_PROXY (corporate/sandbox egress) — no-op when unset. */
async function proxyDispatcher(): Promise<unknown> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return undefined;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxy);
}

async function picsartFetch(path: string, init?: { method?: string; body?: string }): Promise<Response> {
  const env = loadEnv();
  return fetch(`${PICSART_GENAI_BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "X-Picsart-API-Key": env.PICSART_API_KEY ?? "",
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
    },
    ...(init?.body ? { body: init.body } : {}),
    ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
  } as RequestInit);
}

export interface EnhanceImageInput {
  data: Buffer;
  mimeType: string;
  /** Allowed operations only — never material property changes. */
  operations: ("upscale" | "sharpen" | "exposure" | "white-balance" | "denoise")[];
}
export interface ImageEnhancementProvider {
  readonly key: string;
  enhance(input: EnhanceImageInput): Promise<MediaResult>;
}

export interface GenerateMotionInput {
  imageUrl: string;
  /** Conservative camera-motion prompt; providers must preserve the scene. */
  prompt: string;
  durationSeconds: number;
}
export type GenerationStatus =
  | { status: "queued" | "processing" }
  | { status: "completed"; videoUrl: string }
  | { status: "failed"; error: string };

export interface ImageMotionProvider {
  readonly key: string;
  generateMotion(input: GenerateMotionInput): Promise<{ jobId: string }>;
  checkGenerationStatus(jobId: string): Promise<GenerationStatus>;
  downloadGeneration(videoUrl: string): Promise<Buffer>;
  estimateGenerationCostMicroUsd(input: GenerateMotionInput): bigint;
}

/** Motion prompts must always carry these guardrails. */
export const CONSERVATIVE_MOTION_GUARDRAILS =
  "Subtle, slow camera movement only. Preserve the exact architecture, walls, doors, windows, " +
  "flooring, fixtures, and furniture. Do not add or remove any property feature, change room " +
  "proportions, morph geometry, introduce people or text, change lighting unrealistically, or " +
  "invent views outside windows.";

export function picsartConfigured(): boolean {
  return Boolean(loadEnv().PICSART_API_KEY);
}

/** Find a video URL in the (undocumented) result payload, defensively. */
function extractVideoUrl(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const o = body as Record<string, unknown>;
  const candidates: unknown[] = [
    o.url,
    (o.data as Record<string, unknown> | undefined)?.url,
    Array.isArray(o.data) ? (o.data[0] as Record<string, unknown> | undefined)?.url : undefined,
    (o.result as Record<string, unknown> | undefined)?.url,
    (o.video as Record<string, unknown> | undefined)?.url,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.startsWith("http")) return c;
  }
  return undefined;
}

export class PicsartImageMotionProvider implements ImageMotionProvider {
  readonly key = "picsart-image2video";

  async generateMotion(input: GenerateMotionInput): Promise<{ jobId: string }> {
    const model = process.env.PICSART_VIDEO_MODEL ?? DEFAULT_VIDEO_MODEL;
    const res = await picsartFetch("/image2video", {
      method: "POST",
      body: JSON.stringify({
        image_url: input.imageUrl,
        prompt: input.prompt,
        model,
        quality: "720p",
        length: Math.max(3, Math.min(10, Math.round(input.durationSeconds))),
        audio: false,
      }),
    });
    const text = await res.text();
    if (!res.ok && res.status !== 202) {
      throw new Error(`Picsart image2video failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const data = JSON.parse(text) as Record<string, unknown>;
    const jobId =
      (data.inference_id as string | undefined) ??
      (data.id as string | undefined) ??
      ((data.data as Record<string, unknown> | undefined)?.inference_id as string | undefined);
    if (!jobId) throw new Error(`Picsart returned no inference id: ${text.slice(0, 200)}`);
    return { jobId };
  }

  async checkGenerationStatus(jobId: string): Promise<GenerationStatus> {
    try {
      const res = await picsartFetch(`/video/${jobId}`);
      if (res.status === 202) return { status: "processing" };
      const text = await res.text();
      if (!res.ok) return { status: "failed", error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      const body = JSON.parse(text) as Record<string, unknown>;
      const statusStr = String(body.status ?? "").toLowerCase();
      if (["processing", "queued", "pending", "accepted"].includes(statusStr)) {
        return { status: "processing" };
      }
      const videoUrl = extractVideoUrl(body);
      if (videoUrl) return { status: "completed", videoUrl };
      if (["failed", "error"].includes(statusStr)) {
        return { status: "failed", error: text.slice(0, 200) };
      }
      return { status: "processing" };
    } catch (err) {
      log.warn({ jobId, err }, "picsart poll failed");
      return { status: "processing" };
    }
  }

  async downloadGeneration(videoUrl: string): Promise<Buffer> {
    const res = await fetch(videoUrl, {
      ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
    } as RequestInit);
    if (!res.ok) throw new Error(`Picsart clip download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  estimateGenerationCostMicroUsd(_input: GenerateMotionInput): bigint {
    // Credit-based; treated as roughly comparable to other i2v providers
    // until account-specific pricing is known.
    return 550_000n;
  }
}

export function getImageMotionProvider(): ImageMotionProvider | null {
  return picsartConfigured() ? new PicsartImageMotionProvider() : null;
}

export function getImageEnhancementProvider(): ImageEnhancementProvider | null {
  // Enhancement (upscale etc.) lands with the photo-prep pipeline.
  return null;
}
