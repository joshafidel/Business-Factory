import { synthMusicBed, synthSfx, type SfxKind } from "../../utils/wav";
import { type GeneratedAsset, type MusicProvider } from "../types";

/**
 * Music & SFX are synthesized locally (see utils/wav.ts) — original by
 * construction, so there is zero licensing exposure and zero cost. A paid
 * music API can be added later behind the same MusicProvider interface.
 */
export class GeneratedMusicProvider implements MusicProvider {
  readonly key = "generated-synth";

  async musicBed(seconds: number): Promise<GeneratedAsset> {
    return {
      data: synthMusicBed(seconds),
      mime: "audio/wav",
      ext: "wav",
      costUsd: 0,
      provider: this.key,
    };
  }
}

export function sfxAsset(kind: SfxKind): GeneratedAsset {
  return {
    data: synthSfx(kind),
    mime: "audio/wav",
    ext: "wav",
    costUsd: 0,
    provider: "generated-synth",
  };
}

export function getMusicProvider(): MusicProvider {
  return new GeneratedMusicProvider();
}
