import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";
import type { AudioProvider, MediaResult, MusicProvider } from "./media";

/**
 * ElevenLabs adapters — the quality upgrade for narration and music:
 *
 *  - Text-to-speech (eleven_v3, fallback eleven_multilingual_v2): far more
 *    human and expressive than commodity TTS; supports audio tags like
 *    [giggles] and [excited] for real emotional delivery.
 *  - Eleven Music (POST /v1/music): full songs with SUNG vocals from custom
 *    lyrics — trained on licensed music and cleared for commercial use on
 *    paid plans. This is what turns "narration over pictures" into an actual
 *    nursery-rhyme song like the big toddler channels.
 *
 * Everything activates automatically once ELEVENLABS_API_KEY is set.
 */
const EL_BASE = "https://api.elevenlabs.io";

/** "Matilda" — warm, friendly premade female voice; good motherly narrator. */
const DEFAULT_VOICE_ID = "XrExE9yKIg1WjnnlVkGX";

const log = createLogger("elevenlabs");

export function elevenLabsConfigured(): boolean {
  return Boolean(loadEnv().ELEVENLABS_API_KEY);
}

async function proxyDispatcher(): Promise<unknown> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return undefined;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxy);
}

async function elFetch(path: string, body: Record<string, unknown>): Promise<Response> {
  const env = loadEnv();
  return fetch(`${EL_BASE}${path}`, {
    method: "POST",
    headers: {
      "xi-api-key": env.ELEVENLABS_API_KEY ?? "",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
  } as RequestInit);
}

export class ElevenLabsSpeechProvider implements AudioProvider {
  readonly key = "elevenlabs-tts";

  async generateSpeech(params: {
    text: string;
    voice?: string;
    style?: string;
  }): Promise<MediaResult> {
    const env = loadEnv();
    const voiceId = params.voice ?? env.ELEVENLABS_VOICE_ID ?? DEFAULT_VOICE_ID;
    // eleven_v3 is the most expressive model; some plans/voices don't support
    // it yet, so fall back to the universally available multilingual v2.
    for (const modelId of ["eleven_v3", "eleven_multilingual_v2"]) {
      const res = await elFetch(`/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
        text: params.text,
        model_id: modelId,
        voice_settings: { stability: 0.35, similarity_boost: 0.8, style: 0.5 },
      });
      if (!res.ok) {
        const msg = (await res.text()).slice(0, 300);
        if (modelId === "eleven_v3") {
          log.warn({ status: res.status, msg }, "eleven_v3 unavailable; falling back to v2");
          continue;
        }
        throw new Error(`ElevenLabs TTS failed (${res.status}): ${msg}`);
      }
      const data = Buffer.from(await res.arrayBuffer());
      // ~1 credit/char; ≈$0.0002/char on the Creator plan.
      const cost = BigInt(params.text.length * 200);
      return {
        data,
        mimeType: "audio/mpeg",
        costMicroUsd: cost,
        metadata: { model: modelId, voiceId, chars: params.text.length },
      };
    }
    throw new Error("ElevenLabs TTS failed for all models");
  }
}

export class ElevenLabsMusicProvider implements MusicProvider {
  readonly key = "elevenlabs-music";

  async generateMusic(params: { prompt: string; lengthMs: number }): Promise<MediaResult> {
    const lengthMs = Math.max(10_000, Math.min(300_000, Math.round(params.lengthMs)));
    const res = await elFetch(`/v1/music?output_format=mp3_44100_128`, {
      prompt: params.prompt,
      music_length_ms: lengthMs,
      model_id: "music_v1",
    });
    if (!res.ok) {
      throw new Error(`Eleven Music failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    // ~900 credits/minute ≈ $0.20/min on the Creator plan.
    const cost = BigInt(Math.ceil((lengthMs / 60_000) * 200_000));
    return {
      data,
      mimeType: "audio/mpeg",
      costMicroUsd: cost,
      metadata: { model: "music_v1", lengthMs },
    };
  }
}
