import { describe, expect, it } from "vitest";
import { beatAlignedDurations, computeBeatGrid } from "../functions/beat-map";

/** Synthesize a click track: short bursts at the given BPM over `seconds`. */
function clickTrack(bpm: number, seconds: number, rate = 22050): Int16Array {
  const pcm = new Int16Array(Math.floor(seconds * rate));
  const period = (60 / bpm) * rate;
  for (let start = 0; start < pcm.length; start += period) {
    const s0 = Math.floor(start);
    for (let i = 0; i < 800 && s0 + i < pcm.length; i++) {
      const env = Math.exp(-i / 200);
      pcm[s0 + i] = Math.round(Math.sin((i / rate) * 2 * Math.PI * 880) * env * 20000);
    }
  }
  return pcm;
}

describe("beat analysis", () => {
  it("detects a 120 BPM click track within tolerance", () => {
    const map = computeBeatGrid(clickTrack(120, 30));
    expect(Math.abs(map.bpm - 120)).toBeLessThanOrEqual(3);
    expect(map.beats.length).toBeGreaterThan(40);
    expect(map.confidence).toBeGreaterThan(0.1);
  });

  it("detects a 95 BPM click track within tolerance", () => {
    const map = computeBeatGrid(clickTrack(95, 30));
    expect(Math.abs(map.bpm - 95)).toBeLessThanOrEqual(3);
  });

  it("returns empty grid for silence", () => {
    const map = computeBeatGrid(new Int16Array(22050 * 10));
    expect(map.beats.length === 0 || map.confidence <= 0.1).toBe(true);
  });

  it("snaps scene boundaries to beats and preserves total duration", () => {
    const map = computeBeatGrid(clickTrack(120, 50));
    const durations = beatAlignedDurations(48, 6, map);
    expect(durations).toHaveLength(6);
    const total = durations.reduce((a, b) => a + b, 0);
    expect(Math.abs(total - 48)).toBeLessThan(0.01);
    for (const d of durations) expect(d).toBeGreaterThanOrEqual(3.5);
    // Interior boundaries should land on (or very near) a beat.
    let t = 0;
    for (let i = 0; i < 5; i++) {
      t += durations[i] as number;
      const nearest = Math.min(...map.beats.map((b) => Math.abs(b - t)));
      expect(nearest).toBeLessThan(0.15);
    }
  });

  it("falls back to uniform slots when the grid is unusable", () => {
    const durations = beatAlignedDurations(40, 5, { bpm: 0, beats: [], confidence: 0 });
    for (const d of durations) expect(d).toBeCloseTo(8, 5);
  });
});
