import { z } from "zod";

/**
 * All structured content the pipeline produces is validated with these schemas —
 * both when the LLM generates it (live mode) and when fixtures produce it
 * (mock mode), and again every time it is loaded from disk.
 */

// ── Characters ──────────────────────────────────────────────────────────────

export const voiceConfigSchema = z.object({
  provider: z.literal("elevenlabs"),
  /**
   * Stable ElevenLabs voice ID for this character. Fill these in once via
   * data/voice-map.json; the same voice is then used for every episode.
   * Null = not mapped yet (mock TTS still works).
   */
  voiceId: z.string().nullable(),
  stability: z.number().min(0).max(1),
  similarityBoost: z.number().min(0).max(1),
  /** Direction given to TTS style / performance. */
  styleNotes: z.string(),
  /** Mock-voice parameters so every character sounds distinct without keys. */
  mock: z.object({
    baseHz: z.number(),
    lilt: z.number().min(0).max(1),
    rate: z.number().min(2).max(9),
  }),
});

export const characterSchema = z.object({
  /** Stable machine id, e.g. "brock-usa". */
  id: z.string().min(1),
  fullName: z.string().min(1),
  country: z.string().min(1),
  age: z.number().int().min(21),
  gender: z.enum(["man", "woman"]),
  physicalDescription: z.string(),
  clothingStyle: z.string(),
  voiceDescription: z.string(),
  accentDirection: z.string(),
  personality: z.string(),
  datingStrategy: z.string(),
  strength: z.string(),
  fatalFlaw: z.string(),
  secret: z.string(),
  romanticPreference: z.string(),
  rival: z.string(),
  initialAttraction: z.string(),
  recurringJoke: z.string(),
  /** Completely original — never a catchphrase from any real show. */
  signaturePhrase: z.string(),
  imagePrompt: z.string(),
  negativeImagePrompt: z.string(),
  /** Verbatim look-line injected into every scene prompt for consistency. */
  visualReference: z.string(),
  /** Stable seed for providers that support seeding. */
  imageSeed: z.number().int(),
  /** Palette used by the mock art generator AND as color anchors in prompts. */
  palette: z.object({
    skin: z.string(),
    hair: z.string(),
    outfit: z.string(),
    accent: z.string(),
  }),
  voice: voiceConfigSchema,
  /** Short lines in this character's voice, used for chatter and reactions. */
  voicePatterns: z.object({
    exclamations: z.array(z.string()).min(2),
    flirts: z.array(z.string()).min(2),
    conflicts: z.array(z.string()).min(2),
    confessionals: z.array(z.string()).min(2),
  }),
});
export type Character = z.infer<typeof characterSchema>;

export const castSchema = z.array(characterSchema).min(1);

// ── Show bible & villa ──────────────────────────────────────────────────────

export const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  imagePrompt: z.string(),
  negativeImagePrompt: z.string(),
  imageSeed: z.number().int(),
  /** Palette anchors for the mock art generator. */
  palette: z.object({ sky: z.string(), mid: z.string(), ground: z.string(), accent: z.string() }),
  timeOfDay: z.enum(["day", "sunset", "night"]),
});
export type VillaLocation = z.infer<typeof locationSchema>;

export const showBibleSchema = z.object({
  title: z.string(),
  logline: z.string(),
  tone: z.array(z.string()),
  visualStyle: z.string(),
  format: z.object({
    durationSeconds: z.object({ min: z.number(), max: z.number() }),
    structure: z.array(z.object({ beat: z.string(), window: z.string(), rule: z.string() })),
  }),
  writingRules: z.array(z.string()),
  safetyRules: z.array(z.string()),
  brandSafetyRules: z.array(z.string()),
  /** Phrases that must never appear (protected elements of other shows). */
  bannedPhrases: z.array(z.string()),
  villa: z.object({
    name: z.string(),
    island: z.string(),
    description: z.string(),
    locations: z.array(locationSchema).min(7),
  }),
});
export type ShowBible = z.infer<typeof showBibleSchema>;

// ── Season planning ─────────────────────────────────────────────────────────

export const episodeBeatSchema = z.object({
  episode: z.number().int().min(1),
  title: z.string(),
  hook: z.string(),
  summary: z.string(),
  focusCharacters: z.array(z.string()).min(2),
  keyEvents: z.array(z.string()).min(2),
  twist: z.string(),
  engagement: z.object({
    kind: z.enum(["cliffhanger", "vote", "question", "preview"]),
    text: z.string(),
  }),
  /** Hand-tuned signature lines the script generator must include. */
  keyLines: z.array(z.object({ speaker: z.string(), text: z.string() })).default([]),
  unresolvedThreads: z.array(z.string()).default([]),
  connectionToPrevious: z.string(),
});
export type EpisodeBeat = z.infer<typeof episodeBeatSchema>;

export const seasonArcSchema = z.object({
  season: z.number().int(),
  theme: z.string(),
  arcSummary: z.string(),
  episodes: z.array(episodeBeatSchema).min(1),
});
export type SeasonArc = z.infer<typeof seasonArcSchema>;

// ── Episode script ──────────────────────────────────────────────────────────

export const dialogueLineSchema = z.object({
  speaker: z.string(), // character id
  text: z.string().min(1),
  /** Delivery notes for TTS ("furious whisper", "giddy"). */
  delivery: z.string().default(""),
  /** Words to visually emphasize in subtitles. */
  emphasize: z.array(z.string()).default([]),
});
export type DialogueLine = z.infer<typeof dialogueLineSchema>;

export const sceneSchema = z.object({
  index: z.number().int(),
  /** Structural slot in the episode. */
  slot: z.enum(["hook", "setup", "escalation", "twist", "engagement"]),
  /** Visual treatment for the renderer. */
  kind: z.enum(["scene", "confessional", "argument", "text-message", "arrival", "endcard"]),
  locationId: z.string(),
  characters: z.array(z.string()).min(0),
  /** What the camera sees; also drives scene image prompts. */
  visual: z.string(),
  lines: z.array(dialogueLineSchema),
  /** Remotion motion treatment. */
  motion: z.enum(["push-in", "pan-left", "pan-right", "shake", "parallax", "zoom-out"]),
  sfx: z.array(z.enum(["whoosh", "ding", "sting", "pop", "heartbeat"])).default([]),
  /** For text-message scenes: the on-screen chat bubbles. */
  textMessages: z.array(z.object({ from: z.string(), text: z.string() })).default([]),
});
export type Scene = z.infer<typeof sceneSchema>;

export const episodeScriptSchema = z.object({
  episode: z.number().int().min(1),
  title: z.string(),
  logline: z.string(),
  scenes: z.array(sceneSchema).min(4),
  caption: z.string(),
  hashtags: z.array(z.string()).min(5),
  musicDirection: z.string(),
  continuityNotes: z.array(z.string()).default([]),
});
export type EpisodeScript = z.infer<typeof episodeScriptSchema>;

// ── Shot list (derived from the script) ─────────────────────────────────────

export const shotSchema = z.object({
  scene: z.number().int(),
  slot: z.string(),
  kind: z.string(),
  locationId: z.string(),
  characters: z.array(z.string()),
  imagePrompt: z.string(),
  negativeImagePrompt: z.string(),
  motion: z.string(),
  estimatedSeconds: z.number(),
});
export const shotListSchema = z.array(shotSchema);
export type Shot = z.infer<typeof shotSchema>;

// ── Season state (continuity database) ──────────────────────────────────────

export const seasonStateSchema = z.object({
  season: z.number().int(),
  currentEpisode: z.number().int(),
  cast: z.array(z.string()),
  eliminated: z.array(z.string()),
  couples: z.array(z.object({ a: z.string(), b: z.string(), since: z.number().int() })),
  attraction: z.record(z.string(), z.number()), // "a->b": 0..10
  rivalries: z.array(z.object({ a: z.string(), b: z.string(), reason: z.string() })),
  alliances: z.array(z.object({ members: z.array(z.string()), reason: z.string() })),
  secretsRevealed: z.array(z.string()),
  secretsUnrevealed: z.array(z.string()),
  previousEpisodeSummary: z.string(),
  unresolvedStorylines: z.array(z.string()),
  viewerDecisions: z.array(
    z.object({ episode: z.number().int(), question: z.string(), outcome: z.string() }),
  ),
  popularity: z.record(z.string(), z.number()), // characterId -> 0..100
  continuityNotes: z.array(z.string()),
});
export type SeasonState = z.infer<typeof seasonStateSchema>;

export const continuityUpdateSchema = z.object({
  episode: z.number().int(),
  summary: z.string(),
  newCouples: z.array(z.object({ a: z.string(), b: z.string() })).default([]),
  brokenCouples: z.array(z.object({ a: z.string(), b: z.string() })).default([]),
  attractionChanges: z
    .array(z.object({ from: z.string(), to: z.string(), value: z.number() }))
    .default([]),
  newRivalries: z.array(z.object({ a: z.string(), b: z.string(), reason: z.string() })).default([]),
  newAlliances: z.array(z.object({ members: z.array(z.string()), reason: z.string() })).default([]),
  secretsRevealed: z.array(z.string()).default([]),
  arrivals: z.array(z.string()).default([]),
  eliminations: z.array(z.string()).default([]),
  unresolvedStorylines: z.array(z.string()).default([]),
  continuityNotes: z.array(z.string()).default([]),
});
export type ContinuityUpdate = z.infer<typeof continuityUpdateSchema>;

// ── Validation report ───────────────────────────────────────────────────────

export const validationIssueSchema = z.object({
  check: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  message: z.string(),
});
export const validationReportSchema = z.object({
  episode: z.number().int(),
  passed: z.boolean(),
  issues: z.array(validationIssueSchema),
});
export type ValidationReport = z.infer<typeof validationReportSchema>;
export type ValidationIssue = z.infer<typeof validationIssueSchema>;
