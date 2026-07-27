/**
 * Pure-JS 16-bit mono WAV synthesis. Used for:
 *  - mock TTS ("speech-shaped" babble whose duration matches real speech pacing,
 *    so subtitle timing built in mock mode carries over to live mode)
 *  - the royalty-free generated music bed and stings (no licensed audio anywhere)
 *  - simple SFX (whoosh, ding, dramatic sting, message pop)
 */

export const SAMPLE_RATE = 44100;

export function pcmToWav(pcm: Int16Array, sampleRate = SAMPLE_RATE): Buffer {
  const dataSize = pcm.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer, pcm.byteOffset, dataSize)]);
}

/** Duration of a 16-bit mono WAV produced by this module. */
export function wavDurationSeconds(wav: Buffer): number {
  if (wav.length < 44) return 0;
  const sampleRate = wav.readUInt32LE(24);
  const dataSize = wav.readUInt32LE(40);
  return dataSize / 2 / sampleRate;
}

/** Peak amplitude 0..1 — used by validate-episode's clipping check. */
export function wavPeak(wav: Buffer): number {
  let peak = 0;
  for (let i = 44; i + 1 < wav.length; i += 2) {
    const s = Math.abs(wav.readInt16LE(i));
    if (s > peak) peak = s;
  }
  return peak / 32768;
}

/** Deterministic PRNG so mock audio is stable across runs. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MockVoice {
  /** Base pitch in Hz — differentiates characters. */
  baseHz: number;
  /** Pitch wobble amount (accent-ish melody), 0..1. */
  lilt: number;
  /** Speaking rate in syllables/second. */
  rate: number;
}

function syllableCount(text: string): number {
  const words = text
    .toLowerCase()
    .split(/[^a-zà-ÿ']+/)
    .filter(Boolean);
  let n = 0;
  for (const w of words) {
    const groups = w.match(/[aeiouyà-ÿ]+/g);
    n += Math.max(1, groups ? groups.length : 1);
  }
  return n;
}

/** Estimated speech duration for a line (used before any audio exists). */
export function estimateSpeechSeconds(text: string, rate = 5.2): number {
  return Math.max(0.7, syllableCount(text) / rate + 0.35);
}

/**
 * Speech-shaped babble: one soft formant burst per syllable with pitch drift.
 * Not intelligible (by design) — it stands in for TTS with realistic timing.
 */
export function synthMockSpeech(text: string, voice: MockVoice, seed: number): Buffer {
  const rand = mulberry32(seed);
  const syllables = syllableCount(text);
  const secPerSyl = 1 / voice.rate;
  const total = syllables * secPerSyl + 0.35;
  const samples = Math.ceil(total * SAMPLE_RATE);
  const pcm = new Int16Array(samples);
  for (let syl = 0; syl < syllables; syl++) {
    const start = syl * secPerSyl * (0.94 + rand() * 0.12);
    const len = secPerSyl * (0.55 + rand() * 0.3);
    const pitch = voice.baseHz * (1 + (rand() - 0.5) * 0.35 * (1 + voice.lilt));
    const formant = pitch * (2.2 + rand() * 1.6);
    const startSample = Math.floor(start * SAMPLE_RATE);
    const lenSamples = Math.floor(len * SAMPLE_RATE);
    for (let i = 0; i < lenSamples && startSample + i < samples; i++) {
      const t = i / SAMPLE_RATE;
      const env = Math.sin((Math.PI * i) / lenSamples) ** 1.5;
      const glide = 1 + voice.lilt * 0.12 * Math.sin(2 * Math.PI * 2.6 * (start + t));
      const s =
        (Math.sin(2 * Math.PI * pitch * glide * t) * 0.55 +
          Math.sin(2 * Math.PI * formant * t) * 0.22 +
          (rand() - 0.5) * 0.1) *
        env *
        0.42;
      const idx = startSample + i;
      pcm[idx] = clamp16((pcm[idx] ?? 0) + Math.round(s * 32767));
    }
  }
  return pcmToWav(pcm);
}

function clamp16(v: number): number {
  return Math.max(-32768, Math.min(32767, v));
}

/**
 * Reality-show music bed: a four-chord synth loop with a side-chained pump feel
 * and a light hat pattern. Entirely synthesized — zero licensing exposure.
 */
export function synthMusicBed(seconds: number, seed = 7): Buffer {
  const rand = mulberry32(seed);
  const samples = Math.ceil(seconds * SAMPLE_RATE);
  const pcm = new Int16Array(samples);
  const bpm = 112;
  const beat = 60 / bpm;
  // A minor pop loop: Am — F — C — G (roots), with fifths on top.
  const chords = [
    [220.0, 261.63, 329.63],
    [174.61, 220.0, 261.63],
    [130.81, 196.0, 261.63],
    [196.0, 246.94, 293.66],
  ];
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const beatPos = (t / beat) % 1;
    const bar = Math.floor(t / (beat * 4));
    const chord = chords[bar % chords.length] ?? chords[0]!;
    const pump = 0.55 + 0.45 * Math.min(1, beatPos * 3); // duck on each beat
    let s = 0;
    for (const f of chord) s += Math.sin(2 * Math.PI * f * t) / chord.length;
    // Bass an octave below the root, eighth-note pulse.
    const root = (chord[0] ?? 220) / 2;
    const eighth = (t / (beat / 2)) % 1;
    s += Math.sin(2 * Math.PI * root * t) * 0.5 * Math.exp(-3 * eighth);
    // Hats: short noise ticks on off-beats.
    if (beatPos > 0.48 && beatPos < 0.56) s += (rand() - 0.5) * 0.25 * (0.56 - beatPos) * 12;
    pcm[i] = clamp16(Math.round(s * pump * 0.24 * 32767));
  }
  return pcmToWav(pcm);
}

export type SfxKind = "whoosh" | "ding" | "sting" | "pop" | "heartbeat";

/** Small synthesized sound effects for transitions and beats. */
export function synthSfx(kind: SfxKind): Buffer {
  const dur = kind === "sting" ? 1.4 : kind === "heartbeat" ? 1.6 : 0.5;
  const samples = Math.ceil(dur * SAMPLE_RATE);
  const pcm = new Int16Array(samples);
  const rand = mulberry32(kind.length * 1337);
  for (let i = 0; i < samples; i++) {
    const t = i / SAMPLE_RATE;
    const p = t / dur;
    let s = 0;
    switch (kind) {
      case "whoosh":
        s = (rand() - 0.5) * Math.sin(Math.PI * p) ** 2 * (0.3 + 0.7 * p);
        break;
      case "ding":
        s =
          (Math.sin(2 * Math.PI * 1318.5 * t) * 0.6 + Math.sin(2 * Math.PI * 2637 * t) * 0.3) *
          Math.exp(-6 * t);
        break;
      case "sting":
        // Dramatic minor-second hit with a slow swell.
        s =
          (Math.sin(2 * Math.PI * 110 * t) + Math.sin(2 * Math.PI * 116.5 * t)) *
          0.4 *
          (p < 0.15 ? p / 0.15 : Math.exp(-2.2 * (p - 0.15)));
        break;
      case "pop":
        s = Math.sin(2 * Math.PI * (900 - 500 * p) * t) * Math.exp(-18 * t) * 0.9;
        break;
      case "heartbeat": {
        const cycle = (t % 0.8) / 0.8;
        const thump = (at: number): number =>
          cycle > at && cycle < at + 0.09
            ? Math.sin((Math.PI * (cycle - at)) / 0.09) * Math.sin(2 * Math.PI * 55 * t)
            : 0;
        s = (thump(0) + thump(0.18) * 0.7) * 0.9;
        break;
      }
    }
    pcm[i] = clamp16(Math.round(s * 0.6 * 32767));
  }
  return pcmToWav(pcm);
}
