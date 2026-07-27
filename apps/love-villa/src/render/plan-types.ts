/**
 * Browser-safe render-plan types + constants. This module is imported by the
 * Remotion composition, so it must not touch Node built-ins — the Node-side
 * plan builder lives in render-plan.ts.
 */

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export interface PlanLine {
  speaker: string;
  speakerName: string;
  color: string;
  text: string;
  emphasize: string[];
  audioFile: string;
  startFrame: number;
  durationFrames: number;
}

export interface PlanCharacter {
  id: string;
  name: string;
  file: string;
  /** 0 = left, 1 = right, 2 = center. */
  position: number;
}

export interface PlanSfx {
  kind: string;
  file: string;
  atFrame: number;
}

export interface PlanScene {
  index: number;
  slot: string;
  kind: string;
  motion: string;
  startFrame: number;
  durationFrames: number;
  background: string;
  timeOfDay: string;
  characters: PlanCharacter[];
  lines: PlanLine[];
  sfx: PlanSfx[];
  textMessages: { from: string; text: string }[];
  endcardText?: string;
}

export interface RenderPlan {
  episode: number;
  title: string;
  hookText: string;
  fps: number;
  width: number;
  height: number;
  durationFrames: number;
  music: { file: string; volume: number };
  scenes: PlanScene[];
}

const MAX_LINE_CHARS = 18;

/** Word-wrap used by both the subtitle renderer and the overflow validator. */
export function wrapWords(words: string[], maxChars = MAX_LINE_CHARS): string[][] {
  const rows: string[][] = [[]];
  let count = 0;
  for (const w of words) {
    const row = rows[rows.length - 1]!;
    if (count + w.length + row.length > maxChars && row.length > 0) {
      rows.push([w]);
      count = w.length;
    } else {
      row.push(w);
      count += w.length;
    }
  }
  return rows;
}
