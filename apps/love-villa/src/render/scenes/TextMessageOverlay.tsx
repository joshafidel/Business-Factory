import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { type PlanScene } from "../plan-types";

/** Animated chat-bubble overlay for text-message twist scenes. */
export const TextMessageOverlay: React.FC<{ scene: PlanScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 430, left: 70, right: 70 }}>
        {scene.textMessages.map((m, i) => {
          const appear = 12 + i * 22;
          const t = Math.max(0, Math.min(1, (frame - appear) / 8));
          if (t === 0) return null;
          const mine = i % 2 === 1;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                justifyContent: mine ? "flex-end" : "flex-start",
                marginBottom: 26,
                transform: `translateY(${(1 - t) * 30}px) scale(${0.85 + 0.15 * t})`,
                opacity: t,
              }}
            >
              <div
                style={{
                  maxWidth: "78%",
                  background: mine ? "#2f8cff" : "#f2f2f7",
                  color: mine ? "#fff" : "#111",
                  borderRadius: 34,
                  padding: "22px 32px",
                  fontSize: 42,
                  fontWeight: 700,
                  boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
                }}
              >
                <div style={{ fontSize: 26, opacity: 0.65, marginBottom: 6 }}>{m.from}</div>
                {m.text}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
