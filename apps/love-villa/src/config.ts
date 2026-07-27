import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Environment + cost configuration for the Love Villa pipeline.
 *
 * Every external provider is optional: when its key is missing the pipeline
 * automatically runs that provider in MOCK mode (deterministic local assets),
 * so the whole app works end-to-end with zero API keys.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repo-relative app root (apps/love-villa). */
export const APP_ROOT = path.resolve(here, "..");
export const DATA_DIR = path.join(APP_ROOT, "data");
export const ASSETS_DIR = path.join(APP_ROOT, "assets");
export const OUTPUT_DIR = path.join(APP_ROOT, "output");

const envSchema = z.object({
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().default("claude-opus-5"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-1"),
  /** draft | high — image quality used for FINAL renders (drafts always use draft). */
  IMAGE_QUALITY: z.enum(["draft", "high"]).default("draft"),
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL: z.string().default("eleven_multilingual_v2"),
  /** Optional image-to-video provider key (interface only in the MVP). */
  VIDEO_PROVIDER: z.enum(["none"]).default("none"),
  /** Chromium executable for Remotion (auto-detected when unset). */
  REMOTION_BROWSER_EXECUTABLE: z.string().optional(),
  /** Hard per-episode budget in USD. */
  MAX_COST_PER_EPISODE_USD: z.coerce.number().default(5),
  MAX_IMAGES_PER_EPISODE: z.coerce.number().int().default(14),
  MAX_VIDEO_GENS_PER_EPISODE: z.coerce.number().int().default(0),
  MAX_TTS_REGENS_PER_LINE: z.coerce.number().int().default(2),
  /** Reuse previously generated character/location images instead of regenerating. */
  REUSE_EXISTING_ASSETS: z.coerce.boolean().default(true),
});

function loadDotEnv(): void {
  const file = path.join(APP_ROOT, ".env");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

let cached: z.infer<typeof envSchema> | null = null;

export function loadConfig(): z.infer<typeof envSchema> {
  if (cached) return cached;
  loadDotEnv();
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(
      `Invalid environment configuration:\n${issues}\n` +
        `Copy .env.example to .env and fill in the values (all keys are optional — ` +
        `missing keys switch that provider to mock mode).`,
    );
  }
  cached = parsed.data;
  return cached;
}

export type ProviderMode = "live" | "mock";

export interface ProviderStatus {
  llm: ProviderMode;
  images: ProviderMode;
  tts: ProviderMode;
  music: ProviderMode; // always local-generated (royalty-free by construction)
  video: "disabled";
}

export function providerStatus(): ProviderStatus {
  const env = loadConfig();
  return {
    llm: env.ANTHROPIC_API_KEY ? "live" : "mock",
    images: env.OPENAI_API_KEY ? "live" : "mock",
    tts: env.ELEVENLABS_API_KEY ? "live" : "mock",
    music: "mock",
    video: "disabled",
  };
}

export function describeProviders(): string {
  const s = providerStatus();
  return [
    `  LLM (Anthropic):     ${s.llm === "live" ? `LIVE (${loadConfig().ANTHROPIC_MODEL})` : "mock (set ANTHROPIC_API_KEY for real writing)"}`,
    `  Images (OpenAI):     ${s.images === "live" ? "LIVE (gpt-image-1)" : "mock (set OPENAI_API_KEY for real art)"}`,
    `  Voices (ElevenLabs): ${s.tts === "live" ? "LIVE" : "mock (set ELEVENLABS_API_KEY for real voices)"}`,
    `  Music & SFX:         generated locally (royalty-free by construction)`,
    `  Motion:              Remotion camera moves (image-to-video provider: disabled)`,
  ].join("\n");
}
