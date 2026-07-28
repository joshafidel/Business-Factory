import React from "react";
import { useCurrentFrame } from "remotion";
import { wrapWords, type PlanLine, type PlanScene } from "../plan-types";

/**
 * Caption system (owner directives, 2026-07-28):
 *  - Horizontal complete clauses, never a vertical stack of single words.
 *  - At most two rows at a time, centered in the LOWER-middle third of the
 *    frame, clear of faces and UI.
 *  - Word-by-word highlight is color-only — no per-word scaling/rotation
 *    jitter. Emphasized punch words are gold.
 */

const GOLD = "#ffd54a";
const TOP_NARRATOR = 1215;
const TOP_SPEAKER = 1175;
const FONT = 54;
const FONT_EMPH = 62;
const WRAP_CHARS = 20;
const MAX_ROWS = 2;

/** Split a line into clause-sized chunks (≤ ~2 rows each), never mid-clause. */
function clauseChunks(words: string[]): string[][] {
  const limit = WRAP_CHARS * MAX_ROWS;
  const chunks: string[][] = [];
  let current: string[] = [];
  let len = 0;
  for (const w of words) {
    const wLen = w.length + 1;
    const closesClause = /[.!?…]$/.test(w);
    if (len + wLen > limit && current.length > 0) {
      chunks.push(current);
      current = [];
      len = 0;
    }
    current.push(w);
    len += wLen;
    // Prefer breaking right after a finished clause once the chunk has body.
    if (closesClause && len > WRAP_CHARS * 0.8) {
      chunks.push(current);
      current = [];
      len = 0;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

export const Subtitles: React.FC<{ scene: PlanScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const line = scene.lines.find(
    (l) => frame >= l.startFrame && frame < l.startFrame + l.durationFrames + 8,
  );
  if (!line) return null;
  return <SubtitleBlock line={line} frame={frame} />;
};

const SubtitleBlock: React.FC<{ line: PlanLine; frame: number }> = ({ line, frame }) => {
  const isNarrator = line.speaker === "narrator";
  const words = line.text.split(/\s+/).filter(Boolean);
  const totalChars = words.reduce((n, w) => n + w.length, 0) || 1;
  const progress = Math.max(
    0,
    Math.min(1, (frame - line.startFrame) / Math.max(1, line.durationFrames)),
  );
  let spokenChars = progress * totalChars;
  let wordsSpoken = 0;
  for (const w of words) {
    if (spokenChars < w.length * 0.6) break;
    spokenChars -= w.length;
    wordsSpoken++;
  }

  // Pick the chunk containing the currently spoken word; the whole clause is
  // visible at once so viewers read phrases, not flashing single words.
  const chunks = clauseChunks(words);
  let offset = 0;
  let active: string[] | null = null;
  for (const chunk of chunks) {
    if (wordsSpoken < offset + chunk.length) {
      active = chunk;
      break;
    }
    offset += chunk.length;
  }
  if (!active) {
    active = chunks[chunks.length - 1] ?? [];
    offset = words.length - active.length;
  }

  const rows = wrapWords(active, WRAP_CHARS).slice(0, MAX_ROWS);
  const emphasize = new Set(line.emphasize.map((w) => w.toLowerCase().replace(/[^a-zà-ÿ']/gi, "")));
  const fadeIn = Math.min(1, (frame - line.startFrame) / 6);

  let wordIndex = offset;
  return (
    <div
      style={{
        position: "absolute",
        top: isNarrator ? TOP_NARRATOR : TOP_SPEAKER,
        left: 56,
        right: 56,
        textAlign: "center",
        pointerEvents: "none",
        opacity: Math.max(0.5, fadeIn),
      }}
    >
      {!isNarrator ? (
        <div
          style={{
            display: "inline-block",
            background: line.color,
            color: "#14081f",
            fontSize: 28,
            fontWeight: 900,
            borderRadius: 999,
            padding: "3px 20px",
            marginBottom: 8,
            letterSpacing: 2,
            boxShadow: "0 3px 0 rgba(0,0,0,0.4)",
          }}
        >
          {line.speakerName.toUpperCase()}
        </div>
      ) : null}
      {rows.map((row, ri) => (
        <div key={ri} style={{ lineHeight: 1.16, whiteSpace: "nowrap" }}>
          {row.map((w, wi) => {
            const idx = wordIndex++;
            const spoken = idx <= wordsSpoken;
            const clean = w.toLowerCase().replace(/[^a-zà-ÿ']/gi, "");
            const isEmph = emphasize.has(clean);
            return (
              <span
                key={wi}
                style={{
                  display: "inline-block",
                  margin: "0 8px",
                  fontSize: isEmph ? FONT_EMPH : FONT,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  color: isEmph ? GOLD : spoken ? "#ffffff" : "rgba(255,255,255,0.45)",
                  textShadow:
                    "0 4px 0 rgba(0,0,0,0.85), 0 0 22px rgba(0,0,0,0.55), 2px 2px 0 rgba(0,0,0,0.9)",
                  WebkitTextStroke: "2px rgba(0,0,0,0.85)",
                }}
              >
                {w}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
};
