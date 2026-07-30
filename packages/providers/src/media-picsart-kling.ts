import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";

/**
 * Kling 3.0 one-shot video via PICSART's workflows API — the owner's exact
 * Picsart Flow recipe (Kling 3.0, 9:16, 15s, audio on), driven headlessly.
 * Contract lifted from @picsart/ai-sdk's workflows client:
 *
 *   POST https://api.picsart.com/workflows/kling-text-to-video/submit
 *        { params: KlingTextToVideoCommand }            → { taskId }
 *   GET  https://api.picsart.com/workflows/kling-text-to-video/{id}/result
 *        → { status: "COMPLETED"|"FAILED"|..., result }
 *
 * Auth: the developer API key (paat-…), sent both ways Picsart accepts it.
 * PICSART_KLING_MODE selects std | pro | 4k (owner used 4k in Flow; pro is
 * the cost-sane default).
 */
const TASK = "kling-text-to-video";
const BASE = "https://api.picsart.com/workflows";

const log = createLogger("picsart-kling");

export function picsartKlingConfigured(): boolean {
  return Boolean(loadEnv().PICSART_API_KEY);
}

function headers(): Record<string, string> {
  const key = loadEnv().PICSART_API_KEY ?? "";
  return {
    Authorization: `Bearer ${key}`,
    "X-Picsart-API-Key": key,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
}

export async function submitPicsartKling(params: {
  prompt: string;
  durationSeconds?: number;
  negativePrompt?: string;
}): Promise<string> {
  const env = loadEnv();
  const duration = String(Math.min(15, Math.max(5, Math.round(params.durationSeconds ?? 15))));
  const res = await fetch(`${BASE}/${TASK}/submit`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      params: {
        model_name: "kling-v3",
        prompt: params.prompt,
        negative_prompt:
          params.negativePrompt ??
          "blur, distortion, morphing, extra limbs, deformed characters, text, watermark, " +
            "logo, scary imagery, realistic humans, low quality",
        sound: "on",
        mode: env.PICSART_KLING_MODE ?? "pro",
        aspect_ratio: "9:16",
        duration,
        shot_type: "intelligence",
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`picsart kling submit failed (${res.status}): ${text.slice(0, 300)}`);
  }
  const data = JSON.parse(text) as { taskId?: string; task_id?: string; id?: string };
  const id = data.taskId ?? data.task_id ?? data.id;
  if (!id) throw new Error(`picsart kling submit returned no task id: ${text.slice(0, 200)}`);
  return id;
}

export interface PicsartKlingStatus {
  status: "pending" | "completed" | "failed";
  videoUrl?: string;
}

export async function pollPicsartKling(taskId: string): Promise<PicsartKlingStatus> {
  try {
    const res = await fetch(`${BASE}/${TASK}/${taskId}/result`, { headers: headers() });
    if (!res.ok) return { status: res.status >= 500 ? "pending" : "pending" };
    const data = (await res.json()) as {
      status?: string;
      result?: unknown;
    };
    const status = (data.status ?? "").toUpperCase();
    if (status === "COMPLETED") {
      const url = findVideoUrl(data.result ?? data);
      return url ? { status: "completed", videoUrl: url } : { status: "failed" };
    }
    if (status === "FAILED") return { status: "failed" };
    return { status: "pending" };
  } catch (err) {
    log.warn({ taskId, err }, "picsart kling poll failed");
    return { status: "pending" };
  }
}

/** Result shapes vary across Picsart tasks; find the first .mp4/video URL. */
function findVideoUrl(node: unknown, depth = 0): string | undefined {
  if (depth > 6 || node == null) return undefined;
  if (typeof node === "string") {
    return /^https?:\/\/.+\.(mp4|mov|webm)(\?|$)/i.test(node) || /video/i.test(node)
      ? (/^https?:\/\//.test(node) ? node : undefined)
      : undefined;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findVideoUrl(item, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof node === "object") {
    const obj = node as Record<string, unknown>;
    for (const key of ["url", "video_url", "videoUrl", "video", "output", "data", "result", "urls"]) {
      if (key in obj) {
        const hit = findVideoUrl(obj[key], depth + 1);
        if (hit) return hit;
      }
    }
    for (const v of Object.values(obj)) {
      const hit = findVideoUrl(v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

export async function downloadPicsartKling(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`picsart kling download failed (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}
