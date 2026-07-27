import { type Character, type VillaLocation } from "../../ai/schemas";
import { loadConfig } from "../../config";
import { type CostTracker } from "../../utils/cost";
import { type GeneratedAsset } from "../types";
import { characterCutoutSvg, locationBackgroundSvg } from "./mock";
import { estimatedImageCostUsd, OpenAIImageProvider } from "./openai";

/**
 * Image generation façade: live gpt-image-1 when OPENAI_API_KEY is set,
 * deterministic parametric SVG otherwise. Both paths key off the locked
 * palette/seed/look-line on each character and location, so the show stays
 * visually consistent between episodes and across provider switches.
 */

function svgAsset(svg: string): GeneratedAsset {
  return {
    data: Buffer.from(svg),
    mime: "image/svg+xml",
    ext: "svg",
    costUsd: 0,
    provider: "mock-svg",
  };
}

export async function characterImage(
  c: Character,
  tracker: CostTracker,
  quality: "draft" | "high",
): Promise<GeneratedAsset> {
  const env = loadConfig();
  if (!env.OPENAI_API_KEY) {
    tracker.charge({
      provider: "mock-svg",
      item: `character:${c.id}`,
      estimatedUsd: 0,
      mode: "mock",
    });
    return svgAsset(characterCutoutSvg(c));
  }
  tracker.charge({
    provider: "openai",
    item: `character:${c.id}`,
    estimatedUsd: estimatedImageCostUsd(quality),
    mode: "live",
  });
  return new OpenAIImageProvider().generateImage({
    prompt:
      `${c.imagePrompt}. Full upper-body character cutout, facing camera, ` +
      `centered, consistent design reference: ${c.visualReference}`,
    negativePrompt: c.negativeImagePrompt,
    seed: c.imageSeed,
    aspect: "portrait",
    transparent: true,
    characterRefId: c.id,
    quality,
  });
}

export async function locationImage(
  loc: VillaLocation,
  tracker: CostTracker,
  quality: "draft" | "high",
): Promise<GeneratedAsset> {
  const env = loadConfig();
  if (!env.OPENAI_API_KEY) {
    tracker.charge({
      provider: "mock-svg",
      item: `location:${loc.id}`,
      estimatedUsd: 0,
      mode: "mock",
    });
    return svgAsset(locationBackgroundSvg(loc));
  }
  tracker.charge({
    provider: "openai",
    item: `location:${loc.id}`,
    estimatedUsd: estimatedImageCostUsd(quality),
    mode: "live",
  });
  return new OpenAIImageProvider().generateImage({
    prompt: loc.imagePrompt,
    negativePrompt: loc.negativeImagePrompt,
    seed: loc.imageSeed,
    aspect: "portrait",
    quality,
  });
}
