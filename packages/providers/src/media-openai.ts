import { loadEnv } from "@bf/config";
import {
  MockAudioProvider,
  MockImageProvider,
  MockVideoProvider,
  type AudioProvider,
  type ImageProvider,
  type MediaResult,
  type VideoProvider,
} from "./media";

/**
 * Real media generation via OpenAI. Estimated costs (micro-USD):
 * gpt-image-1-mini ≈ $0.01/image at medium quality; gpt-4o-mini-tts ≈
 * $0.015/min of audio (~$12/1M input chars — we bill by characters).
 */
const OPENAI_BASE = "https://api.openai.com/v1";

/** Honor HTTPS_PROXY (corporate/sandbox egress) — no-op when unset. */
async function proxyDispatcher(): Promise<unknown> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return undefined;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxy);
}

async function openaiFetch(path: string, body: Record<string, unknown>): Promise<Response> {
  const env = loadEnv();
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
  } as RequestInit);
  if (!res.ok) {
    throw new Error(`OpenAI ${path} failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  }
  return res;
}

export class OpenAIImageProvider implements ImageProvider {
  readonly key = "openai-image";

  async generateImage(params: { prompt: string }): Promise<MediaResult> {
    const res = await openaiFetch("/images/generations", {
      model: "gpt-image-1-mini",
      prompt: params.prompt,
      size: "1024x1536",
      quality: "medium",
    });
    const data = (await res.json()) as { data: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error("OpenAI image generation returned no image");
    return {
      data: Buffer.from(b64, "base64"),
      mimeType: "image/png",
      costMicroUsd: 15_000n, // ~$0.015 medium-quality estimate
      metadata: { model: "gpt-image-1-mini" },
    };
  }
}

export class OpenAISpeechProvider implements AudioProvider {
  readonly key = "openai-tts";

  async generateSpeech(params: { text: string; voice?: string }): Promise<MediaResult> {
    const res = await openaiFetch("/audio/speech", {
      model: "gpt-4o-mini-tts",
      voice: params.voice ?? "nova",
      input: params.text,
      response_format: "mp3",
      instructions: "Warm, cheerful children's narrator. Clear and not too fast.",
    });
    const data = Buffer.from(await res.arrayBuffer());
    // ~$12 per 1M input characters.
    const cost = BigInt(Math.ceil(params.text.length * 12));
    return {
      data,
      mimeType: "audio/mpeg",
      costMicroUsd: cost,
      metadata: { model: "gpt-4o-mini-tts", chars: params.text.length },
    };
  }
}

export interface MediaProviders {
  image: ImageProvider;
  audio: AudioProvider;
  video: VideoProvider;
  /** True when image+audio are real generators (video assembly can proceed). */
  real: boolean;
}

/** Real providers when OPENAI_API_KEY is set; local mocks otherwise. */
export function getMediaProviders(): MediaProviders {
  const env = loadEnv();
  if (env.OPENAI_API_KEY) {
    return {
      image: new OpenAIImageProvider(),
      audio: new OpenAISpeechProvider(),
      video: new MockVideoProvider(), // assembly happens in the renderer via ffmpeg
      real: true,
    };
  }
  return {
    image: new MockImageProvider(),
    audio: new MockAudioProvider(),
    video: new MockVideoProvider(),
    real: false,
  };
}
