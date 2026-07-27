import { loadConfig } from "../../config";
import { type GeneratedAsset, type MotionProvider } from "../types";
import { FalMotionProvider } from "./fal";

/**
 * Image-to-video generation is OPTIONAL by design: without a key, all motion
 * comes from Remotion (zooms, pans, parallax, shakes, split screens), so the
 * pipeline works with no video-generation API at all.
 *
 * With FAL_KEY set, produce-episode animates each scene's clean-plate still
 * through fal.ai (Kling/Hailuo/Veo/… — FAL_I2V_MODEL) and the final render
 * plays the true animated clip instead of a camera move.
 */
export class DisabledMotionProvider implements MotionProvider {
  readonly key = "disabled";
  readonly enabled = false;

  async imageToVideo(): Promise<GeneratedAsset | null> {
    return null;
  }
}

export function getMotionProvider(): MotionProvider {
  return loadConfig().FAL_KEY ? new FalMotionProvider() : new DisabledMotionProvider();
}
