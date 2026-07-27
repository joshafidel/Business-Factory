import React from "react";
import { useCurrentFrame } from "remotion";
import { wrapWords, type PlanLine, type PlanScene } from "../plan-types";

/**
 * Large animated TikTok-style subtitles:
 *  - inside vertical safe zones (bottom band above TikTok UI, horizontal margins)
 *  - max two lines, wrapped by word
 *  - currently spoken words highlighted progressively
 *  - emphasized words tinted with the speaker's accent color
 *  - speaker name chip so viewers always know who's talking
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
    (l) => frame >= l.startFrame && frame < l.startFrame + l.durationFrames + 6,
  );
  if (!line) return null;
  return <SubtitleBlock line={line} frame={frame} />;
};

const SubtitleBlock: React.FC<{ line: PlanLine; frame: number }> = ({ line, frame }) => {
  const words = line.text.split(/\s+/).filter(Boolean);
  // Progress through the line, weighted by word length (longer words take longer).
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

  const rows = wrapWords(words);
  const { rows: visible, offset } = activeChunk(rows, wordsSpoken);
  const emphasize = new Set(line.emphasize.map((w) => w.toLowerCase().replace(/[^a-zà-ÿ']/gi, "")));

  let wordIndex = offset;
  return (
    <div
      style={{
        position: "absolute",
        bottom: 470,
        left: 60,
        right: 60,
        textAlign: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "inline-block",
          background: "rgba(10, 6, 20, 0.72)",
          borderRadius: 28,
          padding: "18px 30px 24px",
          maxWidth: "100%",
        }}
      >
        <div
          style={{
            display: "inline-block",
            background: line.color,
            color: "#14081f",
            fontSize: 30,
            fontWeight: 900,
            borderRadius: 999,
            padding: "4px 22px",
            marginBottom: 12,
            letterSpacing: 1,
          }}
        >
          {line.speakerName.toUpperCase()}
        </div>
        {visible.map((row, ri) => (
          <div key={ri} style={{ lineHeight: 1.12, whiteSpace: "nowrap" }}>
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
                    margin: "0 8px",
                    fontSize: isEmph ? 66 : 56,
                    fontWeight: 900,
                    color: isEmph
                      ? line.color
                      : spoken || current
                        ? "#ffffff"
                        : "rgba(255,255,255,0.45)",
                    transform: current ? "scale(1.12)" : "scale(1)",
                    textShadow: "0 4px 0 rgba(0,0,0,0.55)",
                    WebkitTextStroke: "1.5px rgba(0,0,0,0.6)",
                  }}
                >
                  {w}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
