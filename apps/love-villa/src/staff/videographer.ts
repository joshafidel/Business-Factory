import { execFileSync } from "node:child_process";
import { renameSync } from "node:fs";
import { resolveFfmpeg } from "../render/render";
import { type Scene } from "../ai/schemas";

/**
 * THE VIDEOGRAPHER — production employee #2 (Directive 2, DIRECTIVES-V3.md).
 * Owns camera language and shot coverage so the finished cut never shows the
 * pan-then-snap-back loop artifact:
 *  - camera directions demand locked-off or SETTLING moves (a settled clip
 *    loops invisibly; an unfinished pan cannot),
 *  - every animated clip is converted to a PALINDROME (forward + reversed)
 *    right after download, so looping never jumps back to frame 0,
 *  - per-scene framing follows the action (confessional = close-up,
 *    argument = two-shot, group reveal = wide).
 */

/** Camera line for the i2v motion prompt — settled moves only. */
export function cameraDirection(scene: Scene): string {
  switch (scene.kind) {
    case "confessional":
      return "Locked-off camera, intimate close-up framing, absolutely no camera movement.";
    case "argument":
      return "Locked-off two-shot; the tension comes from the actors, not the camera.";
    case "arrival":
      return "One slow push-in that fully SETTLES and holds still for the rest of the shot.";
    default:
      return (
        "Camera either locked-off or a very slow push-in that settles early and then holds " +
        "perfectly still; never a pan, never an unfinished move."
      );
  }
}

/** Framing note for the painted scene still, driven by the action. */
export function framingDirection(scene: Scene): string {
  if (scene.kind === "confessional") {
    return "Framing: intimate waist-up close-up, subject centered, background softly blurred.";
  }
  if (scene.kind === "argument") {
    return "Framing: tense two-shot, both characters in frame facing each other in profile-to-camera.";
  }
  if (scene.characters.length >= 3) {
    return "Framing: wide establishing shot placing every character naturally IN the environment at correct scale.";
  }
  return "Framing: medium shot, characters grounded in the environment with believable contact shadows.";
}

/**
 * Convert a downloaded clip into a seamless palindrome (forward+reversed) so
 * loops never snap back to the opening frame. Doubles the effective duration.
 */
export function palindromify(absPath: string): void {
  const ffmpeg = resolveFfmpeg();
  const tmp = `${absPath}.palin.mp4`;
  execFileSync(ffmpeg, [
    "-y",
    "-v",
    "error",
    "-i",
    absPath,
    "-filter_complex",
    "[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1:a=0[v]",
    "-map",
    "[v]",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    tmp,
  ]);
  renameSync(tmp, absPath);
}
