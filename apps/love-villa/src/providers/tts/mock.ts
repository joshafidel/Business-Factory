import { synthMockSpeech, wavDurationSeconds } from "../../utils/wav";
import { type SpeechRequest, type SpeechResult, type TTSProvider } from "../types";

/**
 * Mock voices: speech-shaped babble with per-character pitch, lilt, and rate
 * (from the locked voice config), so timing, pacing, and "who sounds like
 * what" all survive the swap to real TTS.
 */
export class MockTTSProvider implements TTSProvider {
  readonly key = "mock-voice";
  readonly mode = "mock" as const;

  async speak(req: SpeechRequest): Promise<SpeechResult> {
    const data = synthMockSpeech(req.text, req.character.voice.mock, req.seed);
    return {
      data,
      mime: "audio/wav",
      ext: "wav",
      seconds: wavDurationSeconds(data),
      costUsd: 0,
      provider: this.key,
    };
  }
}
