import path from "node:path";
import { generateStructured } from "../ai/anthropic";
import {
  continuityUpdateFromBeat,
  writeEpisodeScriptMock,
} from "../ai/mock-content/episode-writer";
import { episodePrompt } from "../ai/prompts";
import {
  continuityUpdateSchema,
  episodeScriptSchema,
  shotListSchema,
  type Character,
  type ContinuityUpdate,
  type EpisodeBeat,
  type EpisodeScript,
  type SeasonState,
  type Shot,
  type ShowBible,
  type VillaLocation,
} from "../ai/schemas";
import { DATA_DIR } from "../config";
import { type CostTracker } from "../utils/cost";
import { episodeId, readJsonIfExists, writeJson, writeText } from "../utils/fs";
import { estimateSpeechSeconds } from "../utils/wav";

export function episodeDir(episode: number): string {
  return path.join(DATA_DIR, "episodes", episodeId(episode));
}

export function loadEpisodeScript(episode: number): EpisodeScript {
  const file = path.join(episodeDir(episode), "script.json");
  const raw = readJsonIfExists<unknown>(file);
  if (!raw)
    throw new Error(`No script at ${file}. Run: npm run generate-episode -- --episode ${episode}`);
  return episodeScriptSchema.parse(raw);
}

/** Generate the full episode package: script, shot list, captions, continuity update. */
export async function generateEpisode(params: {
  beat: EpisodeBeat;
  bible: ShowBible;
  cast: Character[];
  state: SeasonState;
  tracker: CostTracker;
}): Promise<{ script: EpisodeScript; shots: Shot[]; continuity: ContinuityUpdate }> {
  const { beat, bible, cast, state, tracker } = params;

  const script = await generateStructured({
    item: `episode-${beat.episode}-script`,
    prompt: episodePrompt(bible, cast, state, beat),
    schema: episodeScriptSchema,
    mock: () => writeEpisodeScriptMock(beat, cast, state),
    tracker,
  });
  // Normalize near-miss location ids from the LLM ("villa-kitchen" → "kitchen").
  const knownLocations = bible.villa.locations.map((l) => l.id);
  for (const scene of script.scenes) {
    if (knownLocations.includes(scene.locationId)) continue;
    const match = knownLocations.find(
      (id) => scene.locationId.includes(id) || id.includes(scene.locationId),
    );
    scene.locationId = match ?? "pool";
  }

  const shots = buildShotList(script, bible, cast);
  const continuity = continuityUpdateSchema.parse(continuityUpdateFromBeat(beat));

  const dir = episodeDir(beat.episode);
  writeJson(path.join(dir, "script.json"), script);
  writeJson(path.join(dir, "shot-list.json"), shotListSchema.parse(shots));
  writeJson(path.join(dir, "continuity-update.json"), continuity);
  writeText(path.join(dir, "caption.txt"), script.caption);
  writeText(path.join(dir, "hashtags.txt"), script.hashtags.join(" "));
  writeText(path.join(dir, "script.md"), scriptMarkdown(script, cast, bible));
  return { script, shots, continuity };
}

export function locationById(bible: ShowBible, id: string): VillaLocation {
  const loc = bible.villa.locations.find((l) => l.id === id);
  if (!loc) throw new Error(`Unknown location id: ${id}`);
  return loc;
}

export function buildShotList(script: EpisodeScript, bible: ShowBible, cast: Character[]): Shot[] {
  return script.scenes.map((scene) => {
    const loc = locationById(bible, scene.locationId);
    const looks = scene.characters
      .map((id) => cast.find((c) => c.id === id)?.visualReference)
      .filter(Boolean)
      .join("; ");
    const speech = scene.lines.reduce((sum, l) => sum + estimateSpeechSeconds(l.text), 0);
    return {
      scene: scene.index,
      slot: scene.slot,
      kind: scene.kind,
      locationId: scene.locationId,
      characters: scene.characters,
      imagePrompt:
        `${scene.visual}. Setting: ${loc.imagePrompt}` +
        (looks ? ` Characters (keep these exact designs): ${looks}.` : ""),
      negativeImagePrompt: loc.negativeImagePrompt,
      motion: scene.motion,
      estimatedSeconds: Math.max(2.2, speech + 1.0),
    };
  });
}

function scriptMarkdown(script: EpisodeScript, cast: Character[], bible: ShowBible): string {
  const name = (id: string): string => cast.find((c) => c.id === id)?.fullName.split(" ")[0] ?? id;
  const scenes = script.scenes
    .map((s) => {
      const loc = bible.villa.locations.find((l) => l.id === s.locationId)?.name ?? s.locationId;
      const lines = s.lines.map(
        (l) => `> **${name(l.speaker)}:** ${l.text}${l.delivery ? ` _(${l.delivery})_` : ""}`,
      );
      return `### Scene ${s.index + 1} — ${s.slot.toUpperCase()} · ${s.kind} · ${loc}\n\n_${s.visual}_\n\n${lines.join("\n")}`;
    })
    .join("\n\n");
  return `# Episode ${script.episode}: ${script.title}

_${script.logline}_

Review this file for the "script" approval checkpoint.

${scenes}

## Caption

${script.caption}

${script.hashtags.join(" ")}

## Music direction

${script.musicDirection}
`;
}
