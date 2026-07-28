import path from "node:path";
import { DATA_DIR, loadConfig } from "../../config";
import { readJsonIfExists } from "../../utils/fs";
import { log } from "../../utils/log";
import { type SpeechRequest, type SpeechResult, type TTSProvider } from "../types";
import { MockTTSProvider } from "./mock";

async function fetchOpts(): Promise<Record<string, unknown>> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return {};
  const { ProxyAgent } = await import("undici");
  return { dispatcher: new ProxyAgent(proxy) };
}

/** ~$0.15 per 1k characters (Creator-tier ballpark) — used for the budget guard. */
export function estimatedTtsCostUsd(text: string): number {
  return (text.length / 1000) * 0.15;
}

/**
 * ElevenLabs adapter. Voice stability rule: each character's voice ID comes
 * from data/voice-map.json (characterId → ElevenLabs voice ID) or the
 * character profile, and never changes between episodes. Characters without a
 * mapped voice fall back to mock speech with a warning rather than failing.
 */
export class ElevenLabsTTSProvider implements TTSProvider {
  readonly key = "elevenlabs";
  readonly mode = "live" as const;
  private fallback = new MockTTSProvider();
  private voiceMap: Record<string, string>;

  constructor() {
    this.voiceMap =
      readJsonIfExists<Record<string, string>>(path.join(DATA_DIR, "voice-map.json")) ?? {};
  }

  async speak(req: SpeechRequest): Promise<SpeechResult> {
    const env = loadConfig();
    const voiceId = this.voiceMap[req.character.id] ?? req.character.voice.voiceId;
    if (!voiceId) {
      log.warn(
        `No ElevenLabs voice mapped for ${req.character.id} — add it to data/voice-map.json. Using mock voice.`,
      );
      return this.fallback.speak(req);
    }
    const isV3 = env.ELEVENLABS_MODEL.startsWith("eleven_v3");
    // eleven_v3 understands inline audio tags ("[sarcastic] ...") and treats
    // punctuation as performance direction — feed it the script's delivery
    // note so lines are ACTED, not read. Older models get plain text.
    const tag =
      isV3 && req.delivery
        ? `[${req.delivery
            .toLowerCase()
            .replace(/[^a-z ,-]/g, "")
            .trim()
            .slice(0, 40)}] `
        : "";
    const styled = `${tag}${req.text}`;
    // v3 only accepts the discrete stability presets 0 / 0.5 / 1.
    const stability = isV3
      ? [0, 0.5, 1].reduce((a, b) =>
          Math.abs(b - req.character.voice.stability) < Math.abs(a - req.character.voice.stability)
            ? b
            : a,
        )
      : req.character.voice.stability;
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        ...(await fetchOpts()),
        method: "POST",
        headers: { "xi-api-key": env.ELEVENLABS_API_KEY ?? "", "content-type": "application/json" },
        body: JSON.stringify({
          text: styled,
          model_id: env.ELEVENLABS_MODEL,
          voice_settings: {
            stability,
            similarity_boost: req.character.voice.similarityBoost,
          },
        }),
      },
    );
    if (!res.ok) {
      throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
    }
    const data = Buffer.from(await res.arrayBuffer());
    const { parseBuffer } = await import("music-metadata");
    const meta = await parseBuffer(new Uint8Array(data), { mimeType: "audio/mpeg" });
    const seconds =
      meta.format.duration && meta.format.duration > 0.2
        ? meta.format.duration
        : req.text.length / 14;
    return {
      data,
      mime: "audio/mpeg",
      ext: "mp3",
      seconds,
      costUsd: estimatedTtsCostUsd(req.text),
      provider: this.key,
    };
  }
}
