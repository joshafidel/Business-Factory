import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";

/**
 * Kling 3.0 one-shot video generation via fal.ai — the owner's proven
 * workflow, automated: ONE rich prompt → a complete 15s vertical kids video
 * WITH native audio (music, sfx, sung lines) in a single generation. No
 * stitching, no separate song, no sync problems.
 *
 * Model: fal-ai/kling-video/v3/pro/text-to-video
 * 9:16, 15s, generate_audio: $0.168/s ≈ $2.52 per complete video.
 */
const MODEL = "fal-ai/kling-video/v3/pro/text-to-video";

const log = createLogger("kling-oneshot");

export const KLING_ONESHOT_COST_MICRO_USD_PER_SECOND = 168_000n;

export function klingOneShotConfigured(): boolean {
  return Boolean(loadEnv().FAL_KEY);
}

function headers(): Record<string, string> {
  return { Authorization: `Key ${loadEnv().FAL_KEY}`, "content-type": "application/json" };
}

/** Submit a one-shot generation; returns the fal request id. */
export async function submitOneShotVideo(params: {
  prompt: string;
  durationSeconds?: number;
  negativePrompt?: string;
}): Promise<string> {
  const duration = String(Math.min(15, Math.max(5, Math.round(params.durationSeconds ?? 15))));
  const res = await fetch(`https://queue.fal.run/${MODEL}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      prompt: params.prompt,
      duration,
      aspect_ratio: "9:16",
      generate_audio: true,
      shot_type: "intelligent",
      negative_prompt:
        params.negativePrompt ??
        "blur, distortion, morphing, extra limbs, deformed characters, text, watermark, " +
          "logo, scary imagery, realistic humans, low quality",
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`kling one-shot submit failed (${res.status}): ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { request_id?: string };
  if (!data.request_id) {
    throw new Error(`kling one-shot submit returned no request_id: ${text.slice(0, 200)}`);
  }
  return data.request_id;
}

export interface OneShotStatus {
  status: "pending" | "completed" | "failed";
  videoUrl?: string;
}

/** One poll; transient errors report "pending". */
export async function pollOneShotVideo(requestId: string): Promise<OneShotStatus> {
  try {
    const res = await fetch(`https://queue.fal.run/${MODEL}/requests/${requestId}/status`, {
      headers: headers(),
    });
    if (!res.ok) return { status: "pending" };
    const data = (await res.json()) as { status?: string };
    if (data.status === "COMPLETED") {
      const out = await fetch(`https://queue.fal.run/${MODEL}/requests/${requestId}`, {
        headers: headers(),
      });
      if (!out.ok) return { status: "pending" };
      const result = (await out.json()) as { video?: { url?: string } };
      return result.video?.url
        ? { status: "completed", videoUrl: result.video.url }
        : { status: "failed" };
    }
    if (data.status === "FAILED" || data.status === "CANCELLED") return { status: "failed" };
    return { status: "pending" };
  } catch (err) {
    log.warn({ requestId, err }, "kling one-shot poll failed");
    return { status: "pending" };
  }
}

export async function downloadOneShotVideo(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`kling one-shot download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
