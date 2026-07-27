import { loadConfig } from "../../config";
import { type CostTracker } from "../../utils/cost";
import { type SpeechRequest, type SpeechResult, type TTSProvider } from "../types";
import { ElevenLabsTTSProvider, estimatedTtsCostUsd } from "./elevenlabs";
import { MockTTSProvider } from "./mock";

export function getTTSProvider(): TTSProvider {
  return loadConfig().ELEVENLABS_API_KEY ? new ElevenLabsTTSProvider() : new MockTTSProvider();
}

/** Speak a line through the active provider, with cost accounting. */
export async function speakLine(req: SpeechRequest, tracker: CostTracker): Promise<SpeechResult> {
  const provider = getTTSProvider();
  tracker.charge({
    provider: provider.key,
    item: `tts:${req.character.id}:${req.text.slice(0, 32)}`,
    estimatedUsd: provider.mode === "live" ? estimatedTtsCostUsd(req.text) : 0,
    mode: provider.mode,
  });
  return provider.speak(req);
}
