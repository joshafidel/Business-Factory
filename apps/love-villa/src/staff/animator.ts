import { type Scene } from "../ai/schemas";

/**
 * THE ANIMATOR — production employee #3 (Directive 4, DIRECTIVES-V3.md).
 * Owns motion restraint: stillness is the default, movement is a budget.
 * One deliberate gesture per clip at most; intensity mapped to the beat.
 */

export function motionDirection(scene: Scene): string {
  const base =
    "SUBTLE ACTING ONLY: characters breathe, blink, make small head turns. At most ONE " +
    "deliberate gesture in the whole clip, by the focal character; everyone else stays " +
    "nearly still. No swaying, no constant limb motion, no billowing cloth. ";
  switch (scene.kind) {
    case "confessional":
      return (
        base +
        "This is a confessional: the character sits nearly motionless, one small expression " +
        "change (a smile fading, an eyebrow lift) carries the moment."
      );
    case "argument":
      return (
        base +
        "This is an argument: held eye contact and stiff posture; the single allowed gesture " +
        "is one sharp point or one slow arm-cross by the aggressor."
      );
    case "arrival":
      return base + "The arriving character takes two calm steps and stops; others only turn heads.";
    default:
      if (scene.slot === "twist") {
        return (
          base +
          "This is the twist: the single gesture may be a genuine reaction (a hand to the " +
          "mouth, a dropped object) — everyone else freezes in place."
        );
      }
      return base + "Keep the scene calm and composed; a paused frame must look posed on purpose.";
  }
}
