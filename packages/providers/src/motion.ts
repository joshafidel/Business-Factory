import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";
import {
  higgsfieldConfigured,
  pollJobSet,
  submitImageToVideo,
  downloadClip,
} from "./media-higgsfield";

/**
 * Vendor-agnostic image-to-video motion layer (Animation 2.0, Track A).
 *
 * Every scene-motion request goes through MotionProvider so the pipeline is
 * never coupled to one vendor:
 *  - "higgsfield": DoP models (tier via HIGGSFIELD_MODEL; dop-lite default).
 *  - "fal-kling": Kling 2.x via fal.ai's queue API — noticeably better
 *    character articulation (walks, gestures, object interaction). Active
 *    automatically when FAL_KEY is set.
 *
 * All adapters share one job contract: submit → jobId, poll → status +
 * videoUrl, download → bytes. Costs are estimates recorded per clip.
 */
export interface MotionJob {
  /** Publicly fetchable URL of the source still. */
  imageUrl: string;
  /** Choreographed motion prompt (anticipation → action → settle). */
  prompt: string;
  /** Requested clip length in seconds (providers honor 5 or 10). */
  durationSeconds?: number;
}

export interface MotionJobStatus {
  jobId: string;
  status: "pending" | "completed" | "failed";
  videoUrl?: string;
}

export interface MotionProvider {
  readonly key: string;
  /** Estimated cost per generated clip, micro-USD. */
  readonly clipCostMicroUsd: bigint;
  /** Nominal clip length the provider produces, seconds. */
  readonly clipSeconds: number;
  submit(job: MotionJob): Promise<string>;
  poll(jobId: string): Promise<MotionJobStatus>;
  download(url: string): Promise<Buffer>;
}

const log = createLogger("motion");

const NEGATIVE_GUIDANCE =
  " Strictly keep the exact character designs, colors and proportions from the image. " +
  "Feet stay planted when standing — no sliding, no floating, no morphing, no extra limbs, " +
  "no new characters, no text.";

/** Append shared anti-artifact guidance to a choreography prompt. */
export function withMotionGuardrails(prompt: string): string {
  return prompt.trimEnd() + NEGATIVE_GUIDANCE;
}

class HiggsfieldMotionProvider implements MotionProvider {
  readonly key = "higgsfield";
  readonly clipCostMicroUsd = 550_000n; // ~$0.10/s × ~5.4s
  readonly clipSeconds = 5.3;

  async submit(job: MotionJob): Promise<string> {
    return submitImageToVideo({ imageUrl: job.imageUrl, prompt: job.prompt });
  }

  async poll(jobId: string): Promise<MotionJobStatus> {
    const r = await pollJobSet(jobId);
    if (r.status === "completed" && r.videoUrl) {
      return { jobId, status: "completed", videoUrl: r.videoUrl };
    }
    if (r.status === "failed" || r.status === "nsfw" || r.status === "canceled") {
      return { jobId, status: "failed" };
    }
    return { jobId, status: "pending" };
  }

  download(url: string): Promise<Buffer> {
    return downloadClip(url);
  }
}

/** fal.ai queue API adapter (Kling image-to-video). */
class FalKlingMotionProvider implements MotionProvider {
  readonly key = "fal-kling";
  // Kling 2.1 standard ≈ $0.25 per 5s clip.
  readonly clipCostMicroUsd = 250_000n;
  readonly clipSeconds = 5;
  private readonly model = "fal-ai/kling-video/v2.1/standard/image-to-video";

  private headers(): Record<string, string> {
    const env = loadEnv();
    return { Authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json" };
  }

  async submit(job: MotionJob): Promise<string> {
    const res = await fetch(`https://queue.fal.run/${this.model}`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        prompt: job.prompt,
        image_url: job.imageUrl,
        duration: String(job.durationSeconds === 10 ? 10 : 5),
        negative_prompt:
          "blur, distortion, morphing, extra limbs, deformed face, text, watermark, " +
          "character design changes, sliding feet, floating",
      }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`fal submit failed (${res.status}): ${text.slice(0, 300)}`);
    const data = JSON.parse(text) as { request_id?: string };
    if (!data.request_id)
      throw new Error(`fal submit returned no request_id: ${text.slice(0, 200)}`);
    return data.request_id;
  }

  async poll(jobId: string): Promise<MotionJobStatus> {
    try {
      const res = await fetch(`https://queue.fal.run/${this.model}/requests/${jobId}/status`, {
        headers: this.headers(),
      });
      if (!res.ok) return { jobId, status: "pending" };
      const data = (await res.json()) as { status?: string };
      if (data.status === "COMPLETED") {
        const out = await fetch(`https://queue.fal.run/${this.model}/requests/${jobId}`, {
          headers: this.headers(),
        });
        if (!out.ok) return { jobId, status: "pending" };
        const result = (await out.json()) as { video?: { url?: string } };
        return result.video?.url
          ? { jobId, status: "completed", videoUrl: result.video.url }
          : { jobId, status: "failed" };
      }
      if (data.status === "FAILED" || data.status === "CANCELLED") {
        return { jobId, status: "failed" };
      }
      return { jobId, status: "pending" };
    } catch (err) {
      log.warn({ jobId, err }, "fal poll failed");
      return { jobId, status: "pending" };
    }
  }

  async download(url: string): Promise<Buffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fal clip download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
}

/** Active motion provider, or null when none is configured. */
export function getMotionProvider(): MotionProvider | null {
  const env = loadEnv();
  if (env.FAL_KEY) return new FalKlingMotionProvider();
  if (higgsfieldConfigured()) return new HiggsfieldMotionProvider();
  return null;
}

/**
 * Poll a set of motion jobs until they finish or the deadline passes.
 * Terminal failures are resolved without a URL; still-pending jobs come
 * back as "pending" so callers can retry in a fresh invocation.
 */
export async function awaitMotionJobs(
  provider: MotionProvider,
  jobIds: string[],
  deadlineMs: number,
  pollIntervalMs = 10_000,
): Promise<Map<string, MotionJobStatus>> {
  const results = new Map<string, MotionJobStatus>();
  const pending = new Set(jobIds);
  while (pending.size > 0 && Date.now() < deadlineMs) {
    const polled = await Promise.all([...pending].map((id) => provider.poll(id)));
    for (const r of polled) {
      if (r.status === "completed" || r.status === "failed") {
        results.set(r.jobId, r);
        pending.delete(r.jobId);
      }
    }
    if (pending.size > 0) {
      await new Promise((r) =>
        setTimeout(r, Math.min(pollIntervalMs, Math.max(0, deadlineMs - Date.now()))),
      );
    }
  }
  for (const id of pending) results.set(id, { jobId: id, status: "pending" });
  return results;
}
