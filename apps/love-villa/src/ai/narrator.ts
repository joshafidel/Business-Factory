import { type Character } from "./schemas";

/**
 * The Narrator — the engine of the viral object-love-island format.
 *
 * An off-screen, omniscient, extremely sassy storyteller who speaks in short,
 * punchy, present-tense gossip ("This is Brock. Brock is about to ruin his
 * whole life."). Most of an episode's audio is narrator lines; contestants
 * get short reaction quotes. The persona is ORIGINAL — never an imitation of
 * any real show's narrator.
 */

export const NARRATOR_ID = "narrator";

export function isNarrator(speakerId: string): boolean {
  return speakerId === NARRATOR_ID;
}

/**
 * Full Character shape for the narrator so TTS/render code paths need no
 * special cases beyond lookup. Off-screen: never appears in scene character
 * lists, exempt from continuity/cast checks.
 */
export const NARRATOR: Character = {
  id: NARRATOR_ID,
  fullName: "The Narrator",
  country: "Off-screen",
  age: 99,
  gender: "woman",
  physicalDescription: "Off-screen voice only.",
  clothingStyle: "N/A — off-screen.",
  voiceDescription:
    "Fast, sassy, husky storyteller; permanently unbothered, secretly delighted by the chaos.",
  accentDirection: "Neutral, crisp, extremely energetic delivery with sharp comedic pauses.",
  personality:
    "Omniscient gossip. Talks about contestants like a friend recapping drama at 1am. Zero mercy, full affection.",
  datingStrategy: "N/A",
  strength: "Makes any 3-second beat feel like breaking news.",
  fatalFlaw: "Physically incapable of minding her own business.",
  secret: "Ships all of them.",
  romanticPreference: "The drama itself",
  rival: "silence",
  initialAttraction: "none",
  recurringJoke: "Addresses the audience directly ('Chat, look at his face. LOOK at it.').",
  signaturePhrase: "Anyway — chaos.",
  imagePrompt: "off-screen narrator, never rendered",
  negativeImagePrompt: "n/a",
  visualReference: "off-screen — never rendered",
  imageSeed: 99999,
  palette: { skin: "#000000", hair: "#000000", outfit: "#000000", accent: "#ffd54a" },
  voice: {
    provider: "elevenlabs",
    // Default: "Callum — Husky Trickster" (present in every account's default
    // roster). Override per-account in data/voice-map.json under "narrator".
    voiceId: "N2lVS1w4EtoT3dr4eOWO",
    stability: 0.4,
    similarityBoost: 0.8,
    styleNotes:
      "Fast, sassy, deadpan-excited gossip storytelling; punchy pauses; talks TO the audience.",
    mock: { baseHz: 150, lilt: 0.45, rate: 6.2 },
  },
  voicePatterns: {
    exclamations: ["Chaos.", "I cannot make this up.", "Anyway."],
    flirts: ["They're so in love it's disgusting.", "Someone check on France."],
    conflicts: ["It's about to go DOWN.", "War. Actual war."],
    confessionals: ["Between us? She's lying.", "He believes that. He really does."],
  },
};
