import { type Character } from "../ai/schemas";

/** A generated binary asset plus everything needed to account for it. */
export interface GeneratedAsset {
  data: Buffer;
  mime: string;
  ext: string;
  /** Estimated provider cost in USD (0 for mock/local generation). */
  costUsd: number;
  provider: string;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt: string;
  /** Stable seed — honored by providers that support seeding. */
  seed?: number;
  aspect: "portrait" | "square";
  /** Transparent background (character cutouts). */
  transparent?: boolean;
  /** Reference-image conditioning, when the provider supports it. */
  referenceImages?: Buffer[];
  /** Stable character reference id, for providers with character consistency. */
  characterRefId?: string;
  quality: "draft" | "high";
}

export interface ImageProvider {
  readonly key: string;
  readonly mode: "live" | "mock";
  generateImage(req: ImageRequest): Promise<GeneratedAsset>;
}

export interface SpeechRequest {
  text: string;
  character: Character;
  /** Performance direction ("furious whisper"). */
  delivery?: string;
  /** Deterministic seed for mock voices. */
  seed: number;
}

export interface SpeechResult extends GeneratedAsset {
  seconds: number;
}

export interface TTSProvider {
  readonly key: string;
  readonly mode: "live" | "mock";
  speak(req: SpeechRequest): Promise<SpeechResult>;
}

export interface MusicProvider {
  readonly key: string;
  /** A loopable bed of at least `seconds` length. */
  musicBed(seconds: number): Promise<GeneratedAsset>;
}

/**
 * Optional image-to-video motion provider. The MVP ships the interface plus a
 * disabled implementation — all motion comes from Remotion camera moves — so a
 * real provider (e.g. an API that animates stills) can be dropped in later
 * without touching the pipeline.
 */
export interface MotionProvider {
  readonly key: string;
  readonly enabled: boolean;
  imageToVideo(req: {
    image: Buffer;
    prompt: string;
    seconds: number;
  }): Promise<GeneratedAsset | null>;
}
