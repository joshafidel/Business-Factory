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

export interface MusicProvider {
  readonly key: string;
  /** Generate a full song (vocals + instruments) from a styled prompt with lyrics. */
  generateMusic(params: { prompt: string; lengthMs: number }): Promise<MediaResult>;
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
    // Real silence sized to the text (~15 chars/sec of speech) so downstream
    // duration math and audio muxing behave exactly like a real clip.
    const rate = 24000;
    const seconds = Math.min(30, Math.max(0.5, params.text.length / 15));
    const samples = new Int16Array(Math.ceil(seconds * rate));
    const dataSize = samples.length * 2;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(rate, 24);
    header.writeUInt32LE(rate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);
    return {
      data: Buffer.concat([header, Buffer.from(samples.buffer)]),
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
