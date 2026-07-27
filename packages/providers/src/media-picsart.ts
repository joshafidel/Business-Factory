import { loadEnv } from "@bf/config";
import { type MediaResult } from "./media";

/**
 * Adapter interfaces for optional photo enhancement and AI image-to-video
 * motion, plus the (future) Picsart implementation slot. The Listing Video
 * Factory defaults to deterministic motion; these providers are strictly
 * additive and their absence disables only the related feature.
 *
 * NOTE: intentionally NOT implemented against a guessed Picsart model id —
 * per policy the concrete endpoint/model must be verified against current
 * official Picsart documentation with a live key before wiring it up.
 * `picsartConfigured()` gates every UI affordance until then.
 */

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

/**
 * Placeholder that keeps call sites honest: everything behind
 * `picsartConfigured()` today, so this never runs in production paths.
 */
export function getImageMotionProvider(): ImageMotionProvider | null {
  // Implemented when Picsart access is verified against current docs.
  return null;
}

export function getImageEnhancementProvider(): ImageEnhancementProvider | null {
  return null;
}
