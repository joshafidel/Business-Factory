import React from "react";
import { Composition } from "remotion";
import { EpisodeComposition } from "./episode-composition";
import { FPS, HEIGHT, WIDTH, type RenderPlan } from "./plan-types";

/** Minimal placeholder plan so the composition registers without props. */
const EMPTY_PLAN: RenderPlan = {
  episode: 0,
  title: "Love Villa: Nations",
  hookText: "",
  fps: FPS,
  width: WIDTH,
  height: HEIGHT,
  durationFrames: FPS * 3,
  music: { file: "", volume: 0 },
  scenes: [],
};

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="Episode"
      component={EpisodeComposition}
      durationInFrames={EMPTY_PLAN.durationFrames}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
      defaultProps={{ plan: EMPTY_PLAN }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(FPS, props.plan.durationFrames),
        fps: props.plan.fps,
        width: props.plan.width,
        height: props.plan.height,
      })}
    />
  );
};
