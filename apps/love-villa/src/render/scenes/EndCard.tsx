import React from "react";
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { type PlanScene, type RenderPlan } from "../plan-types";

/** Final engagement card: vote/cliffhanger text over a dimmed villa shot. */
export const EndCard: React.FC<{ scene: PlanScene; plan: RenderPlan }> = ({ scene, plan }) => {
  const frame = useCurrentFrame();
  const pop = Math.min(1, frame / 10);
  const pulse = 1 + Math.sin(frame / 8) * 0.02;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={staticFile(scene.background)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: `scale(${1.2 - 0.06 * pop})`,
          filter: "brightness(0.45) saturate(1.2)",
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: 80 }}>
        <div
          style={{
            textAlign: "center",
            transform: `scale(${pop * pulse})`,
            opacity: pop,
          }}
        >
          <div
            style={{
              color: "#ffb347",
              fontSize: 44,
              fontWeight: 900,
              letterSpacing: 4,
              marginBottom: 30,
            }}
          >
            LOVE VILLA: NATIONS
          </div>
          <div
            style={{
              color: "#ffffff",
              fontSize: 76,
              fontWeight: 900,
              lineHeight: 1.2,
              textShadow: "0 6px 0 rgba(0,0,0,0.45)",
            }}
          >
            {scene.endcardText ?? plan.title}
          </div>
          <div
            style={{
              marginTop: 60,
              display: "inline-block",
              background: "linear-gradient(90deg, #ff5fa2, #ffb347)",
              color: "#2a0f2e",
              fontSize: 46,
              fontWeight: 900,
              padding: "20px 48px",
              borderRadius: 999,
            }}
          >
            FOLLOW FOR EPISODE {plan.episode + 1} ➜
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
