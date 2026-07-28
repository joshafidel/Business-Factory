import { type VideoTemplate } from "./templates";

/**
 * Caption + timing helpers shared by the renderer (scene lengths, overlay
 * windows), the SRT builder, and the browser-side overlay rasterizer (line
 * wrapping) — one timing model everywhere.
 */

/** Wrap to at most `maxLines` lines of `maxChars`; overflow is ellipsized.
 *  Mobile-safe captions are max two short lines. */
export function wrapCaption(text: string, maxChars = 26, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    const lastLine = lines[maxLines - 1]!;
    lines[maxLines - 1] = lastLine.endsWith("…")
      ? lastLine
      : `${lastLine.slice(0, Math.max(0, maxChars - 1))}…`;
  }
  return lines;
}

export interface SceneTiming {
  /** Seconds from video start where the scene becomes fully visible. */
  start: number;
  /** Scene slot length (crossfades overlap into neighbours). */
  duration: number;
}

/**
 * Scene lengths. With narration, each scene stretches to fit its voice clip
 * (plus breathing room) inside template bounds — a clip longer than the
 * template max wins, narration is never cut. Without narration, scenes share
 * the target duration equally within bounds.
 */
export function computeSceneTimings(params: {
  sceneCount: number;
  template: VideoTemplate;
  targetSeconds: number;
  /** Per-scene narration length in seconds; 0/undefined = no narration. */
  narrationSeconds?: number[];
  /** Extra tail scene (agent outro card), seconds. 0 = none. */
  outroSeconds?: number;
}): { timings: SceneTiming[]; totalSeconds: number } {
  const { sceneCount, template } = params;
  const fade = template.transitionSeconds;
  const durations: number[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const voice = params.narrationSeconds?.[i] ?? 0;
    if (voice > 0.2) {
      durations.push(
        Math.max(
          template.minSceneSeconds,
          Math.min(voice + 0.9, Math.max(template.maxSceneSeconds, voice + 0.5)),
        ),
      );
    } else {
      const share = params.targetSeconds / sceneCount;
      durations.push(Math.max(template.minSceneSeconds, Math.min(template.maxSceneSeconds, share)));
    }
  }
  if (params.outroSeconds && params.outroSeconds > 0) durations.push(params.outroSeconds);

  const timings: SceneTiming[] = [];
  let cursor = 0;
  for (const d of durations) {
    timings.push({ start: cursor, duration: d });
    cursor += d - fade;
  }
  const totalSeconds = cursor + fade;
  return { timings, totalSeconds };
}

/** Standard SRT for the caption sidecar in the output package. */
export function buildSrt(entries: { text: string; start: number; end: number }[]): string {
  const stamp = (t: number): string => {
    const ms = Math.max(0, Math.round(t * 1000));
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    const rem = ms % 1000;
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(rem, 3)}`;
  };
  return entries
    .filter((e) => e.text.trim())
    .map((e, i) => `${i + 1}\n${stamp(e.start)} --> ${stamp(e.end)}\n${e.text.trim()}\n`)
    .join("\n");
}
