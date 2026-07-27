import { loadConfig } from "../../config";
import { log } from "../../utils/log";
import { type GeneratedAsset, type MotionProvider } from "../types";

/**
 * fal.ai image-to-video adapter — the "extremely high animation standard" tier.
 *
 * fal.ai (https://fal.ai) is an aggregator: one FAL_KEY unlocks many i2v
 * models (Kling, MiniMax Hailuo, Wan, Veo, LTX…) behind one queue API, so the
 * model is just an env string (FAL_I2V_MODEL). The pipeline renders a clean
 * still of each scene (full composited frame, no overlays), sends it here
 * with the scene's motion prompt, and the returned clip replaces the
 * Ken-Burns-style camera move in the final render — real character motion,
 * cloth/hair physics, parallax, and micro-expressions instead of pans.
 *
 * Queue protocol: POST https://queue.fal.run/{model} → {request_id,
 * status_url, response_url}; poll status until COMPLETED; GET response_url
 * for the video URL. Source images are passed as data URIs (no hosting).
 */

async function fetchOpts(): Promise<Record<string, unknown>> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return {};
  const { ProxyAgent } = await import("undici");
  return { dispatcher: new ProxyAgent(proxy) };
}

export class FalMotionProvider implements MotionProvider {
  readonly key = "fal-i2v";
  readonly enabled = true;

  async imageToVideo(req: {
    image: Buffer;
    prompt: string;
    seconds: number;
  }): Promise<GeneratedAsset | null> {
    const env = loadConfig();
    if (!env.FAL_KEY) return null;
    const model = env.FAL_I2V_MODEL;
    const headers = { authorization: `Key ${env.FAL_KEY}`, "content-type": "application/json" };

    const submit = await fetch(`https://queue.fal.run/${model}`, {
      ...(await fetchOpts()),
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: req.prompt,
        image_url: `data:image/png;base64,${req.image.toString("base64")}`,
        duration: String(Math.round(req.seconds)),
      }),
    });
    if (!submit.ok) {
      throw new Error(
        `fal.ai submit failed (${submit.status}): ${(await submit.text()).slice(0, 300)}`,
      );
    }
    const job = (await submit.json()) as {
      request_id: string;
      status_url: string;
      response_url: string;
    };
    log.info(`fal.ai job ${job.request_id} queued (${model})`);

    // Poll — i2v models typically take 1-5 minutes per clip.
    const deadline = Date.now() + 8 * 60_000;
    for (;;) {
      if (Date.now() > deadline)
        throw new Error(`fal.ai job ${job.request_id} timed out after 8 minutes`);
      const res = await fetch(job.status_url, { ...(await fetchOpts()), headers });
      const status = (await res.json()) as { status: string; error?: unknown };
      if (status.status === "COMPLETED") break;
      if (status.status === "FAILED" || status.error) {
        throw new Error(
          `fal.ai job failed: ${JSON.stringify(status.error ?? status.status).slice(0, 200)}`,
        );
      }
      await new Promise((r) => setTimeout(r, 6000));
    }

    const result = await fetch(job.response_url, { ...(await fetchOpts()), headers });
    if (!result.ok) throw new Error(`fal.ai result fetch failed (${result.status})`);
    const body = (await result.json()) as { video?: { url?: string } };
    const url = body.video?.url;
    if (!url)
      throw new Error(`fal.ai returned no video URL: ${JSON.stringify(body).slice(0, 200)}`);
    const download = await fetch(url, await fetchOpts());
    if (!download.ok) throw new Error(`fal.ai clip download failed (${download.status})`);
    return {
      data: Buffer.from(await download.arrayBuffer()),
      mime: "video/mp4",
      ext: "mp4",
      costUsd: env.MOTION_COST_PER_CLIP_USD,
      provider: this.key,
    };
  }
}
