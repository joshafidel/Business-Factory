import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
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

// One grade for every scene — uniform saturation/contrast keeps cuts feeling
// like the same show even when clips come from different generations.
const HOUSE_GRADE = "saturate(1.08) contrast(1.03)";

const SceneBlock: React.FC<{ scene: PlanScene; plan: RenderPlan }> = ({ scene, plan }) => {
  return (
    <AbsoluteFill>
      {scene.kind === "endcard" ? (
        <EndCard scene={scene} plan={plan} />
      ) : (
        <>
          <AbsoluteFill style={{ filter: HOUSE_GRADE }}>
            <SceneShot scene={scene} />
          </AbsoluteFill>
          {scene.kind === "text-message" ? <TextMessageOverlay scene={scene} /> : null}
          {plan.cleanPlate ? null : (
            <>
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
