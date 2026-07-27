import { type GeneratedAsset, type MotionProvider } from "../types";

/**
 * Image-to-video generation is OPTIONAL by design: the MVP creates all motion
 * in Remotion (zooms, pans, parallax, shakes, split screens, reaction cuts),
 * so the pipeline works with no video-generation API at all.
 *
 * To add a real provider later (e.g. an API that animates stills), implement
 * MotionProvider, return the clip from imageToVideo(), and the render plan
 * builder will prefer real clips over Ken-Burns-style moves for those scenes.
 */
export class DisabledMotionProvider implements MotionProvider {
  readonly key = "disabled";
  readonly enabled = false;

  async imageToVideo(): Promise<GeneratedAsset | null> {
    return null;
  }
}

export function getMotionProvider(): MotionProvider {
  return new DisabledMotionProvider();
}
