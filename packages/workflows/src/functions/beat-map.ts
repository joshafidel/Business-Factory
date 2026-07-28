import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveFfmpeg } from "./media-utils";

/**
 * Beat analysis for musical cut timing (Animation 2.0).
 *
 * Cuts that land on beats are the cheapest, highest-impact "professional
 * feel" win: the whole video starts breathing with the song. Pure TS on
 * ffmpeg-decoded PCM — no native DSP dependencies.
 */
export interface BeatMap {
  bpm: number;
  /** Beat timestamps in seconds from the start of the track. */
  beats: number[];
  /** Confidence 0..1 (autocorrelation peak sharpness). */
  confidence: number;
}

const RATE = 22050;
const HOP = 512;

/** Decode an mp3/wav buffer to mono 16-bit PCM at 22.05 kHz. */
export function decodeToPcm(audio: Buffer): Int16Array {
  const dir = mkdtempSync(path.join(os.tmpdir(), "beat-"));
  try {
    const inFile = path.join(dir, "in.audio");
    const outFile = path.join(dir, "out.pcm");
    writeFileSync(inFile, audio);
    execFileSync(
      resolveFfmpeg(),
      ["-y", "-i", inFile, "-ac", "1", "-ar", String(RATE), "-f", "s16le", outFile],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 },
    );
    const raw = readFileSync(outFile);
    return new Int16Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 2));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Estimate tempo and beat grid from PCM via onset-energy autocorrelation.
 * Exposed separately from decoding so tests can feed synthetic signals.
 */
export function computeBeatGrid(pcm: Int16Array, rate = RATE): BeatMap {
  const hops = Math.floor(pcm.length / HOP);
  if (hops < 32) return { bpm: 0, beats: [], confidence: 0 };

  // Onset envelope: positive energy flux per hop.
  const energy = new Float64Array(hops);
  for (let h = 0; h < hops; h++) {
    let sum = 0;
    const base = h * HOP;
    for (let i = 0; i < HOP; i++) {
      const s = (pcm[base + i] as number) / 32768;
      sum += s * s;
    }
    energy[h] = sum;
  }
  const flux = new Float64Array(hops);
  for (let h = 1; h < hops; h++) {
    flux[h] = Math.max(0, (energy[h] as number) - (energy[h - 1] as number));
  }

  // Autocorrelate the flux over musically plausible lags (55–180 BPM).
  const hopSec = HOP / rate;
  const minLag = Math.floor(60 / 180 / hopSec);
  const maxLag = Math.ceil(60 / 55 / hopSec);
  let bestLag = 0;
  let bestScore = 0;
  let totalScore = 0;
  for (let lag = minLag; lag <= Math.min(maxLag, hops - 1); lag++) {
    let score = 0;
    for (let h = 0; h + lag < hops; h++) score += (flux[h] as number) * (flux[h + lag] as number);
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }
  if (bestLag === 0) return { bpm: 0, beats: [], confidence: 0 };

  // Octave correction: autocorrelation loves the doubled period (120 BPM
  // scores at the 60 BPM lag too). Prefer the faster tempo whenever the
  // half-lag explains the signal nearly as well.
  const scoreAt = (lag: number): number => {
    let s = 0;
    for (let h = 0; h + lag < hops; h++) s += (flux[h] as number) * (flux[h + lag] as number);
    return s;
  };
  while (bestLag >= 2 * minLag) {
    // Search a small window around lag/2 — the true half-period rarely
    // lands on an integer hop.
    let half = 0;
    let halfScore = 0;
    const center = bestLag / 2;
    for (let l = Math.floor(center) - 2; l <= Math.ceil(center) + 2; l++) {
      if (l < minLag) continue;
      const s = scoreAt(l);
      if (s > halfScore) {
        halfScore = s;
        half = l;
      }
    }
    if (half > 0 && halfScore >= 0.5 * bestScore) {
      bestLag = half;
      bestScore = halfScore;
    } else {
      break;
    }
  }
  const period = bestLag * hopSec;
  const bpm = 60 / period;

  // Phase: shift the grid to best align with onsets.
  let bestPhase = 0;
  let bestPhaseScore = -1;
  for (let p = 0; p < bestLag; p++) {
    let score = 0;
    for (let h = p; h < hops; h += bestLag) score += flux[h] as number;
    if (score > bestPhaseScore) {
      bestPhaseScore = score;
      bestPhase = p;
    }
  }
  const duration = hops * hopSec;
  const beats: number[] = [];
  for (let t = bestPhase * hopSec; t < duration; t += period) beats.push(Number(t.toFixed(3)));

  const meanScore = totalScore / Math.max(1, maxLag - minLag + 1);
  const confidence = meanScore > 0 ? Math.min(1, (bestScore / meanScore - 1) / 4) : 0;
  return { bpm: Number(bpm.toFixed(1)), beats, confidence: Number(confidence.toFixed(2)) };
}

/** Convenience: decode + analyze. */
export function analyzeBeats(audio: Buffer): BeatMap {
  return computeBeatGrid(decodeToPcm(audio));
}

/**
 * Split `total` seconds into `n` scene durations whose boundaries land on
 * beats (within `snapWindow`), so cuts feel musical. Falls back to equal
 * slots when the beat grid is empty or low-confidence.
 */
export function beatAlignedDurations(
  total: number,
  n: number,
  map: BeatMap,
  opts: { minScene?: number; snapWindow?: number } = {},
): number[] {
  const minScene = opts.minScene ?? 3.5;
  const snapWindow = opts.snapWindow ?? 0.9;
  const uniform = Array.from({ length: n }, () => total / n);
  if (n < 2 || map.beats.length < 4 || map.confidence < 0.1) return uniform;

  const bounds: number[] = [0];
  for (let i = 1; i < n; i++) {
    const target = (i * total) / n;
    let snapped = target;
    let bestDist = snapWindow;
    for (const b of map.beats) {
      const d = Math.abs(b - target);
      if (d < bestDist && b > (bounds[i - 1] as number) + minScene && b < total - minScene) {
        bestDist = d;
        snapped = b;
      }
    }
    bounds.push(Math.max(snapped, (bounds[i - 1] as number) + minScene));
  }
  bounds.push(total);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((bounds[i + 1] as number) - (bounds[i] as number));
  return out;
}
