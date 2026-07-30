import { loadConfig } from "../../config";
import { type GeneratedAsset, type ImageProvider, type ImageRequest } from "../types";

/** Honor HTTPS_PROXY (corporate/sandbox egress) — no-op when unset. */
async function fetchOpts(): Promise<Record<string, unknown>> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return {};
  const { ProxyAgent } = await import("undici");
  return { dispatcher: new ProxyAgent(proxy) };
}

/** Published gpt-image-1 pricing (portrait 1024x1536), USD per image. */
const COST_BY_QUALITY: Record<string, number> = { low: 0.016, medium: 0.063, high: 0.25 };

/**
 * OpenAI gpt-image-1 adapter.
 *
 * Capability notes against the ImageProvider interface:
 *  - seed control: NOT supported by gpt-image-1 — consistency comes from the
 *    verbatim visualReference look-lines injected into every prompt.
 *  - reference conditioning / characterRefId: not wired in the MVP (the edits
 *    endpoint accepts reference images; swap-in point documented in README).
 *  - transparent backgrounds: supported (background: "transparent").
 */
export class OpenAIImageProvider implements ImageProvider {
  readonly key = "openai-gpt-image";
  readonly mode = "live" as const;

  async generateImage(req: ImageRequest): Promise<GeneratedAsset> {
    const env = loadConfig();
    const quality = req.quality === "high" ? "medium" : "low";
    const prompt = `${req.prompt}\n\nStrictly avoid: ${req.negativePrompt}`;
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      ...(await fetchOpts()),
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.OPENAI_IMAGE_MODEL,
        prompt,
        n: 1,
        size: req.aspect === "portrait" ? "1024x1536" : "1024x1024",
        quality,
        ...(req.transparent ? { background: "transparent", output_format: "png" } : {}),
      }),
    });
    if (!res.ok) {
      throw new Error(
        `OpenAI image generation failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
      );
    }
    const body = (await res.json()) as { data: { b64_json: string }[] };
    const b64 = body.data[0]?.b64_json;
    if (!b64) throw new Error("OpenAI image generation returned no image data");
    return {
      data: Buffer.from(b64, "base64"),
      mime: "image/png",
      ext: "png",
      costUsd: COST_BY_QUALITY[quality] ?? 0.07,
      provider: this.key,
    };
  }
}

export function estimatedImageCostUsd(quality: "draft" | "high"): number {
  return COST_BY_QUALITY[quality === "high" ? "medium" : "low"] ?? 0.07;
}

/**
 * gpt-image-1 EDIT call with reference images (the Videographer's painted
 * scene stills): characters + location art go in as references, one composed
 * scene comes out with unified lighting — Directive 3's core capability.
 */
export async function editImageWithReferences(params: {
  prompt: string;
  references: Buffer[];
  quality: "draft" | "high" | "max";
}): Promise<GeneratedAsset> {
  const env = loadConfig();
  const quality = params.quality === "max" ? "high" : params.quality === "high" ? "medium" : "low";
  const form = new FormData();
  form.append("model", env.OPENAI_IMAGE_MODEL);
  form.append("prompt", params.prompt);
  form.append("size", "1024x1536");
  form.append("quality", quality);
  form.append("n", "1");
  params.references.slice(0, 6).forEach((buf, i) => {
    form.append("image[]", new Blob([new Uint8Array(buf)], { type: "image/png" }), `ref-${i}.png`);
  });
  const res = await fetch("https://api.openai.com/v1/images/edits", {
    ...(await fetchOpts()),
    method: "POST",
    headers: { authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(
      `OpenAI image edit failed (${res.status}): ${(await res.text()).slice(0, 300)}`,
    );
  }
  const body = (await res.json()) as { data: { b64_json: string }[] };
  const b64 = body.data[0]?.b64_json;
  if (!b64) throw new Error("OpenAI image edit returned no image data");
  return {
    data: Buffer.from(b64, "base64"),
    mime: "image/png",
    ext: "png",
    costUsd: COST_BY_QUALITY[quality] ?? 0.07,
    provider: "openai-gpt-image",
  };
}
