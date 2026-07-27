import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Subtitles } from "./captions/Subtitles";
import { EndCard } from "./scenes/EndCard";
import { SceneShot } from "./scenes/SceneShot";
import { TextMessageOverlay } from "./scenes/TextMessageOverlay";
import { type PlanScene, type RenderPlan } from "./plan-types";

const FONT = `"Arial Black", Arial, "DejaVu Sans", sans-serif`;

export const EpisodeComposition: React.FC<{ plan: RenderPlan }> = ({ plan }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#12081f", fontFamily: FONT }}>
      {plan.music.file ? (
        <Audio src={staticFile(plan.music.file)} volume={plan.music.volume} loop />
      ) : null}
      {plan.scenes.map((scene) => (
        <Sequence
          key={scene.index}
          from={scene.startFrame}
          durationInFrames={scene.durationFrames}
          name={`S${scene.index + 1}-${scene.slot}`}
        >
          <SceneBlock scene={scene} plan={plan} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const SceneBlock: React.FC<{ scene: PlanScene; plan: RenderPlan }> = ({ scene, plan }) => {
  return (
    <AbsoluteFill>
      {scene.kind === "endcard" ? (
        <EndCard scene={scene} plan={plan} />
      ) : (
        <>
          <SceneShot scene={scene} />
          {scene.kind === "text-message" ? <TextMessageOverlay scene={scene} /> : null}
          {plan.cleanPlate ? null : (
            <>
              {scene.slot === "hook" ? <HookTitle text={plan.hookText} /> : null}
              <ShowChip episode={plan.episode} />
              <Subtitles scene={scene} />
            </>
          )}
        </>
      )}
      {scene.lines.map((line, i) => (
        <Sequence key={i} from={line.startFrame} durationInFrames={line.durationFrames + 4}>
          <Audio src={staticFile(line.audioFile)} />
        </Sequence>
      ))}
      {scene.sfx.map((s, i) => (
        <Sequence key={`sfx-${i}`} from={s.atFrame} durationInFrames={60}>
          <Audio src={staticFile(s.file)} volume={0.55} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/** Big top-of-screen hook headline for the cold open. */
const HookTitle: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const pop = Math.min(1, frame / 7);
  return (
    <div
      style={{
        position: "absolute",
        top: 240,
        left: 48,
        right: 48,
        textAlign: "center",
        transform: `scale(${0.8 + 0.2 * pop})`,
        opacity: pop,
      }}
    >
      <div
        style={{
          display: "inline-block",
          background: "rgba(18, 8, 31, 0.82)",
          border: "5px solid #ff5fa2",
          borderRadius: 32,
          padding: "26px 34px",
          color: "#ffffff",
          fontSize: 62,
          fontWeight: 900,
          lineHeight: 1.15,
          textShadow: "0 4px 0 rgba(0,0,0,0.4)",
        }}
      >
        {text}
      </div>
    </div>
  );
};

const ShowChip: React.FC<{ episode: number }> = ({ episode }) => (
  <div
    style={{
      position: "absolute",
      top: 130,
      width: "100%",
      textAlign: "center",
      opacity: 0.92,
    }}
  >
    <span
      style={{
        background: "linear-gradient(90deg, #ff5fa2, #ffb347)",
        color: "#2a0f2e",
        borderRadius: 999,
        padding: "10px 28px",
        fontSize: 34,
        fontWeight: 900,
        letterSpacing: 2,
      }}
    >
      LOVE VILLA: NATIONS · EP {episode}
    </span>
  </div>
);
