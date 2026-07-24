/**
 * Media generation interfaces (image / audio / video). Real adapters arrive
 * with the business modules; mock implementations let workflows exercise the
 * full pipeline today. Mock output is a tiny valid file so the storage and
 * asset paths are genuinely tested.
 */

export interface MediaResult {
  /** Raw bytes of the generated media. */
  data: Buffer;
  mimeType: string;
  costMicroUsd: bigint;
  metadata?: Record<string, unknown>;
}

export interface ImageProvider {
  readonly key: string;
  generateImage(params: { prompt: string; width?: number; height?: number }): Promise<MediaResult>;
}

export interface AudioProvider {
  readonly key: string;
  generateSpeech(params: { text: string; voice?: string; style?: string }): Promise<MediaResult>;
}

export interface VideoProvider {
  readonly key: string;
  generateVideo(params: { prompt: string; durationSeconds?: number }): Promise<MediaResult>;
}

/** 1×1 transparent PNG. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

export class MockImageProvider implements ImageProvider {
  readonly key = "mock-image";
  async generateImage(params: { prompt: string }): Promise<MediaResult> {
    return {
      data: TINY_PNG,
      mimeType: "image/png",
      costMicroUsd: 0n,
      metadata: { mock: true, prompt: params.prompt.slice(0, 100) },
    };
  }
}

export class MockAudioProvider implements AudioProvider {
  readonly key = "mock-audio";
  async generateSpeech(params: { text: string }): Promise<MediaResult> {
    // Minimal valid WAV header + silence.
    const header = Buffer.from(
      "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=",
      "base64",
    );
    return {
      data: header,
      mimeType: "audio/wav",
      costMicroUsd: 0n,
      metadata: { mock: true, chars: params.text.length },
    };
  }
}

export class MockVideoProvider implements VideoProvider {
  readonly key = "mock-video";
  async generateVideo(params: { prompt: string }): Promise<MediaResult> {
    return {
      data: Buffer.from(`MOCK-VIDEO:${params.prompt.slice(0, 64)}`),
      mimeType: "video/mp4",
      costMicroUsd: 0n,
      metadata: { mock: true },
    };
  }
}
