/**
 * Video style templates. Fully data-driven: the renderer, script generator,
 * and voice pipeline all read these values — adding a template is adding an
 * entry here, not writing a new composition.
 */

export type MotionPreset = "zoom-in" | "zoom-out" | "pan-lr" | "pan-rl" | "push-in";

export interface VideoTemplate {
  key: string;
  name: string;
  description: string;
  /** Whether the template narrates at all. */
  voiceover: boolean;
  /** Scene length bounds (seconds). Narration can stretch up to max. */
  minSceneSeconds: number;
  maxSceneSeconds: number;
  /** Crossfade length between scenes (seconds). */
  transitionSeconds: number;
  /** xfade transition cycle (data-driven — see `ffmpeg -h filter=xfade`). */
  transitions: string[];
  /** Motion preset cycle applied photo-by-photo. */
  motion: MotionPreset[];
  /** Max zoom factor — how much movement a scene gets. */
  zoomAmount: number;
  /** Default target duration in seconds. */
  defaultTargetSeconds: number;
  /** Music bed style passed to the synth ("warm" | "bright" | "minimal"). */
  musicStyle: "warm" | "bright" | "minimal";
  musicVolume: number;
  /** Tone brief injected into the script prompt. */
  scriptTone: string;
  /** Voice direction passed to the TTS provider. */
  voiceStyle: string;
  /** AI-motion camera language: steadicam glide vs FPV drone flight. */
  motionStyle?: "gimbal" | "drone";
}

export const VIDEO_TEMPLATES: Record<string, VideoTemplate> = {
  "drone-flythrough": {
    key: "drone-flythrough",
    name: "Drone Fly-Through",
    description: "One continuous flight through the house — every shot flies forward, rooms connect.",
    voiceover: true,
    minSceneSeconds: 4,
    maxSceneSeconds: 8,
    transitionSeconds: 0.5,
    // zoomin punches through the end of one shot into the next — the classic
    // FPV doorway transition; every scene's motion is a forward flight, so
    // the cut reads as continuing the same flight path.
    transitions: ["zoomin"],
    motion: ["push-in"],
    zoomAmount: 1.16,
    defaultTargetSeconds: 45,
    musicStyle: "warm",
    musicVolume: 0.12,
    scriptTone:
      "A continuous guided flight through the home. Write the narration so rooms flow into each " +
      "other ('through the entry…', 'gliding into the kitchen…', 'and out back…') — movement " +
      "words, short flowing sentences, cinematic but factual. Never claim two rooms physically " +
      "connect unless the supplied facts say so; keep the flow language about the tour, not the floor plan.",
    voiceStyle:
      "A smooth, cinematic tour narrator carried along on a gliding camera. Flowing, unhurried " +
      "delivery that never fully stops — each line hands off to the next room. Warm, awed, real.",
    motionStyle: "drone",
  },
  "luxury-cinematic": {
    key: "luxury-cinematic",
    name: "Luxury Cinematic",
    description: "Slow, elegant movement, longer shots, refined narration.",
    voiceover: true,
    minSceneSeconds: 4,
    maxSceneSeconds: 9,
    transitionSeconds: 1.0,
    transitions: ["fade"],
    motion: ["push-in", "zoom-out", "pan-lr", "zoom-in", "pan-rl"],
    zoomAmount: 1.08,
    defaultTargetSeconds: 75,
    musicStyle: "warm",
    musicVolume: 0.1,
    scriptTone:
      "Refined, understated luxury. Unhurried sentences. Let the property speak; no hype words, " +
      "no exclamation marks. Vocabulary of an upscale architectural magazine.",
    voiceStyle:
      "A polished, warm narrator for a luxury property film. Calm, low-key confidence, " +
      "measured pace, softly enthusiastic at signature features. Never salesy.",
  },
  "fast-social": {
    key: "fast-social",
    name: "Fast Social",
    description: "Hook-first, quick cuts, big captions. Built for TikTok and Reels.",
    voiceover: true,
    minSceneSeconds: 2.2,
    maxSceneSeconds: 5,
    transitionSeconds: 0.35,
    transitions: ["fade", "slideleft", "fade", "slideright"],
    motion: ["push-in", "pan-lr", "zoom-in", "pan-rl", "zoom-out"],
    zoomAmount: 1.14,
    defaultTargetSeconds: 35,
    musicStyle: "bright",
    musicVolume: 0.14,
    scriptTone:
      "Punchy and conversational, like a top real-estate creator on TikTok. Open with a strong " +
      "hook in the first sentence. Short sentences. Concrete facts over adjectives.",
    voiceStyle:
      "An energetic, friendly social-video narrator. Quick natural pace, genuinely excited " +
      "but real — like showing a friend a great apartment. Conversational, never announcer-like.",
  },
  "clean-professional": {
    key: "clean-professional",
    name: "Clean Professional",
    description: "Neutral styling, clear room labels, straightforward narration.",
    voiceover: true,
    minSceneSeconds: 3.5,
    maxSceneSeconds: 7,
    transitionSeconds: 0.6,
    transitions: ["fade"],
    motion: ["zoom-in", "zoom-out", "pan-lr", "pan-rl"],
    zoomAmount: 1.1,
    defaultTargetSeconds: 60,
    musicStyle: "minimal",
    musicVolume: 0.08,
    scriptTone:
      "Clear, factual, and professional — suitable for a brokerage website. Neutral adjectives, " +
      "plain descriptions of each room, no slang, no hype.",
    voiceStyle:
      "A clear, professional narrator for a brokerage listing video. Neutral, friendly, " +
      "articulate, steady pacing. Trustworthy rather than exciting.",
  },
  "no-narration-showcase": {
    key: "no-narration-showcase",
    name: "No-Narration Showcase",
    description: "Music, property facts, and smooth motion — no spoken voice-over.",
    voiceover: false,
    minSceneSeconds: 3,
    maxSceneSeconds: 4.5,
    transitionSeconds: 0.8,
    transitions: ["fade"],
    motion: ["push-in", "pan-lr", "zoom-out", "pan-rl", "zoom-in"],
    zoomAmount: 1.1,
    defaultTargetSeconds: 45,
    musicStyle: "warm",
    musicVolume: 0.3,
    scriptTone:
      "No narration. Write on-screen captions only: 3-8 words each, factual, elegant. " +
      "The hook is the opening caption.",
    voiceStyle: "",
  },
};

export function getTemplate(key: string): VideoTemplate {
  return VIDEO_TEMPLATES[key] ?? VIDEO_TEMPLATES["fast-social"]!;
}
