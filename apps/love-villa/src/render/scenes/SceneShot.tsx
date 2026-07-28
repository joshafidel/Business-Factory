import React from "react";
import {
  AbsoluteFill,
  Img,
  interpolate,
  Loop,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { type PlanScene } from "../plan-types";

/**
 * A single scene: animated background (camera moves), character cutouts with
 * speaker emphasis, plus per-kind treatments (confessional vignette, argument
 * split-screen, arrival spotlight). All motion is Remotion-generated so no
 * video API is required.
 */
export const SceneShot: React.FC<{ scene: PlanScene }> = ({ scene }) => {
  const frame = useCurrentFrame();
  const d = scene.durationFrames;
  const p = Math.min(1, frame / Math.max(1, d));

  const activeLine = scene.lines.find(
    (l) => frame >= l.startFrame && frame < l.startFrame + l.durationFrames,
  );
  const activeSpeaker = activeLine?.speaker;
  // Punch-in: a subtle zoom pop at the start of every line keeps cut rhythm
  // without jittering character proportions between beats.
  const sinceLine = activeLine ? frame - activeLine.startFrame : 99;
  const punch = 1 + 0.028 * Math.exp(-sinceLine / 5);
  const camera = `${cameraTransform(scene.motion, p, frame)} scale(${punch.toFixed(4)})`;

  // True animated clip (image-to-video): the characters and set are baked into
  // the clip, so play it full-bleed (looped to cover the scene) with a very
  // gentle push-in on top for continuity with the house camera language.
  if (scene.clipFile) {
    return (
      <AbsoluteFill style={{ overflow: "hidden" }}>
        <AbsoluteFill style={{ transform: `scale(${((1 + 0.04 * p) * punch).toFixed(4)})` }}>
          <Loop durationInFrames={Math.max(1, scene.clipDurationFrames ?? scene.durationFrames)}>
            <OffthreadVideo
              src={staticFile(scene.clipFile)}
              muted
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </Loop>
        </AbsoluteFill>
        {scene.kind === "confessional" ? <ConfessionalFrame /> : null}
      </AbsoluteFill>
    );
  }

  if (scene.kind === "argument" && scene.characters.length >= 2) {
    return <ArgumentSplit scene={scene} activeSpeaker={activeSpeaker} />;
  }

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: camera }}>
        <Img
          src={staticFile(scene.background)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </AbsoluteFill>
      {scene.kind === "confessional" ? <ConfessionalFrame /> : null}
      {scene.characters.map((c, i) => {
        const n = scene.characters.length;
        const speaking = c.id === activeSpeaker;
        const parallax = scene.motion === "parallax" ? (c.position === 0 ? 1 : -1) * p * 40 : 0;
        const bob = Math.sin((frame + i * 20) / 9) * 8;
        const entering = scene.kind === "arrival" && i === n - 1;
        const approach = entering
          ? interpolate(p, [0, 0.65], [0.45, 1], { extrapolateRight: "clamp" })
          : 1;
        // Crowd layout: 1-2 characters keep the classic big two-shot; 3+ are
        // spread evenly and shrunk so nobody's face is occluded by a
        // neighbor (Quality Director finding: stacked cutouts read as warped
        // faces / floating hands).
        let x: string;
        let width: string;
        if (n === 1) {
          x = "17%";
          width = "66%";
        } else if (n === 2) {
          x = i === 0 ? "-6%" : "40%";
          width = "66%";
        } else {
          const w = n === 3 ? 40 : 33;
          const span = 100 - w + 8;
          x = `${-4 + (i * span) / (n - 1)}%`;
          width = `${w}%`;
        }
        // Match the cutouts to the set's key light so they don't read as
        // flat frontal-lit stickers (Quality Director finding).
        const timeGrade =
          scene.timeOfDay === "sunset"
            ? "sepia(0.22) saturate(1.15) brightness(0.96)"
            : scene.timeOfDay === "night"
              ? "brightness(0.85) saturate(0.92) hue-rotate(-8deg)"
              : "";
        return (
          <div
            key={c.id}
            style={{
              position: "absolute",
              bottom: entering ? -40 + (1 - approach) * 300 : -40,
              left: x,
              width,
              transform: `translateX(${parallax}px) translateY(${bob}px) scale(${(speaking ? 1.07 : 1) * approach})`,
              transformOrigin: "bottom center",
              filter: `${timeGrade} ${
                speaking
                  ? "brightness(1.08) drop-shadow(0 0 34px rgba(255,95,162,0.55))"
                  : "brightness(0.94) drop-shadow(0 10px 24px rgba(0,0,0,0.45))"
              }`,
              zIndex: speaking ? 4 : i === Math.floor(n / 2) ? 3 : 2,
            }}
          >
            <Img src={staticFile(c.file)} style={{ width: "100%" }} />
          </div>
        );
      })}
      {scene.kind === "arrival" ? <ArrivalGlow /> : null}
    </AbsoluteFill>
  );
};

function cameraTransform(motion: string, p: number, frame: number): string {
  switch (motion) {
    case "push-in":
      return `scale(${1 + 0.14 * p})`;
    case "zoom-out":
      return `scale(${1.16 - 0.14 * p})`;
    case "pan-left":
      return `scale(1.18) translateX(${interpolate(p, [0, 1], [4, -4])}%)`;
    case "pan-right":
      return `scale(1.18) translateX(${interpolate(p, [0, 1], [-4, 4])}%)`;
    case "shake": {
      const decay = Math.max(0, 1 - frame / 24);
      const dx = Math.sin(frame * 2.7) * 14 * decay;
      const dy = Math.cos(frame * 3.3) * 10 * decay;
      return `scale(1.12) translate(${dx}px, ${dy}px)`;
    }
    case "parallax":
      return `scale(1.15) translateX(${interpolate(p, [0, 1], [-2, 2])}%)`;
    default:
      return `scale(${1 + 0.1 * p})`;
  }
}

const ConfessionalFrame: React.FC = () => (
  <AbsoluteFill style={{ pointerEvents: "none" }}>
    <AbsoluteFill
      style={{
        boxShadow: "inset 0 0 260px 90px rgba(20, 4, 34, 0.92)",
      }}
    />
    <div
      style={{
        position: "absolute",
        inset: 70,
        border: "6px solid rgba(255,95,162,0.85)",
        borderRadius: 48,
        boxShadow: "0 0 42px rgba(255,95,162,0.5)",
      }}
    />
    <div
      style={{
        position: "absolute",
        top: 96,
        right: 120,
        color: "#ff5fa2",
        fontSize: 38,
        fontWeight: 900,
        letterSpacing: 3,
      }}
    >
      ● THE SPILL ROOM
    </div>
  </AbsoluteFill>
);

const ArrivalGlow: React.FC = () => (
  <AbsoluteFill
    style={{
      pointerEvents: "none",
      background:
        "radial-gradient(ellipse 60% 45% at 50% 62%, rgba(255,179,71,0.34), rgba(0,0,0,0) 70%)",
    }}
  />
);

const ArgumentSplit: React.FC<{ scene: PlanScene; activeSpeaker?: string }> = ({
  scene,
  activeSpeaker,
}) => {
  const frame = useCurrentFrame();
  const [left, right] = scene.characters;
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {[left, right].map((c, side) => {
        if (!c) return null;
        const speaking = c.id === activeSpeaker;
        return (
          <div
            key={c.id}
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: side === 0 ? 0 : "50%",
              width: "50%",
              overflow: "hidden",
              borderRight: side === 0 ? "6px solid #ff5fa2" : undefined,
            }}
          >
            <Img
              src={staticFile(scene.background)}
              style={{
                position: "absolute",
                width: "200%",
                height: "100%",
                objectFit: "cover",
                left: side === 0 ? 0 : "-100%",
                transform: `scale(${1.12 + Math.sin(frame / 14) * 0.01})`,
                filter: speaking ? "brightness(1)" : "brightness(0.7)",
              }}
            />
            <div
              style={{
                position: "absolute",
                bottom: -30,
                left: "-14%",
                width: "128%",
                transform: `scaleX(${side === 0 ? 1 : -1}) scale(${speaking ? 1.06 : 0.98})`,
                transformOrigin: "bottom center",
                filter: speaking
                  ? "drop-shadow(0 0 30px rgba(255,95,162,0.6))"
                  : "brightness(0.85)",
              }}
            >
              <Img src={staticFile(c.file)} style={{ width: "100%" }} />
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: "absolute",
          top: "38%",
          width: "100%",
          textAlign: "center",
          transform: `scale(${1 + Math.sin(frame / 5) * 0.04})`,
        }}
      >
        <span
          style={{
            background: "#ff2d55",
            color: "#fff",
            fontSize: 64,
            fontWeight: 900,
            padding: "12px 36px",
            borderRadius: 24,
            boxShadow: "0 6px 0 rgba(0,0,0,0.35)",
          }}
        >
          VS
        </span>
      </div>
    </AbsoluteFill>
  );
};
