import React from "react";
import { useCurrentFrame } from "remotion";
import { wrapWords, type PlanLine, type PlanScene } from "../plan-types";

/**
 * Viral-short captions: huge bold text high-center (the object-love-island
 * look), word-by-word highlight as it's spoken, punch words in gold, heavy
 * outline for readability on any art. Narrator lines have no name chip (she's
 * the voice of the show); contestant quotes keep a small colored chip.
 */

/** Split a wrapped block into chunks of ≤2 rows shown sequentially. */
function activeChunk(rows: string[][], wordsSpoken: number): { rows: string[][]; offset: number } {
  const chunks: string[][][] = [];
  for (let i = 0; i < rows.length; i += 2) chunks.push(rows.slice(i, i + 2));
  let offset = 0;
  for (const chunk of chunks) {
    const chunkWords = chunk.reduce((n, r) => n + r.length, 0);
    if (wordsSpoken < offset + chunkWords) return { rows: chunk, offset };
    offset += chunkWords;
  }
  const last = chunks[chunks.length - 1] ?? [[]];
  return { rows: last, offset: Math.max(0, offset - last.reduce((n, r) => n + r.length, 0)) };
}

export const Subtitles: React.FC<{ scene: PlanScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const line = scene.lines.find(
    (l) => frame >= l.startFrame && frame < l.startFrame + l.durationFrames + 5,
  );
  if (!line) return null;
  return <SubtitleBlock line={line} frame={frame} />;
};

const GOLD = "#ffd54a";

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

  const rows = wrapWords(words, 14);
  const { rows: visible, offset } = activeChunk(rows, wordsSpoken);
  const emphasize = new Set(line.emphasize.map((w) => w.toLowerCase().replace(/[^a-zà-ÿ']/gi, "")));
  const pop = Math.min(1, (frame - line.startFrame) / 5);

  let wordIndex = offset;
  return (
    <div
      style={{
        position: "absolute",
        top: isNarrator ? 300 : 270,
        left: 40,
        right: 40,
        textAlign: "center",
        pointerEvents: "none",
        transform: `scale(${0.92 + 0.08 * pop})`,
        opacity: Math.max(0.6, pop),
      }}
    >
      {!isNarrator ? (
        <div
          style={{
            display: "inline-block",
            background: line.color,
            color: "#14081f",
            fontSize: 32,
            fontWeight: 900,
            borderRadius: 999,
            padding: "4px 24px",
            marginBottom: 10,
            letterSpacing: 2,
            boxShadow: "0 4px 0 rgba(0,0,0,0.4)",
          }}
        >
          {line.speakerName.toUpperCase()}
        </div>
      ) : null}
      {visible.map((row, ri) => (
        <div key={ri} style={{ lineHeight: 1.08, whiteSpace: "nowrap" }}>
          {row.map((w, wi) => {
            const idx = wordIndex++;
            const spoken = idx < wordsSpoken;
            const current = idx === wordsSpoken;
            const clean = w.toLowerCase().replace(/[^a-zà-ÿ']/gi, "");
            const isEmph = emphasize.has(clean);
            return (
              <span
                key={wi}
                style={{
                  display: "inline-block",
                  margin: "0 7px",
                  fontSize: isEmph ? 84 : 70,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  color: isEmph ? GOLD : spoken || current ? "#ffffff" : "rgba(255,255,255,0.55)",
                  transform: current
                    ? "scale(1.14) rotate(-1.5deg)"
                    : isEmph
                      ? "rotate(1deg)"
                      : "none",
                  textShadow:
                    "0 5px 0 rgba(0,0,0,0.85), 0 0 26px rgba(0,0,0,0.55), 3px 3px 0 rgba(0,0,0,0.9)",
                  WebkitTextStroke: "2.5px rgba(0,0,0,0.85)",
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
