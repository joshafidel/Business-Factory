import path from "node:path";
import { generateStructured } from "../ai/anthropic";
import {
  continuityUpdateFromBeat,
  writeEpisodeScriptMock,
} from "../ai/mock-content/episode-writer";
import { episodePrompt } from "../ai/prompts";
import { writePitches } from "../staff/plot-writer";
import {
  loadQualityReport,
  reviewScript,
  saveQualityReport,
  scriptReviewPasses,
  type ScriptReview,
} from "../quality/quality-director";
import { log } from "../utils/log";
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

function scoreAvg(r: ScriptReview): number {
  const s = r.scores;
  return (
    (s.hook +
      s.comedicEngine +
      s.causalEscalation +
      s.characterVoice +
      s.comedicPacing +
      s.ending) /
    6
  );
}

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

  // Draft → Quality Director review → (if below the bar) revise with the
  // critique injected, up to MAX_DRAFTS total attempts. The best-scoring
  // draft wins if none passes outright.
  // Plot Writer first: three pitches, best one wins, Script Writer must follow it.
  const pitchSet = await writePitches({ beat, bible, cast, state, tracker });
  const pitch = pitchSet.pitches[pitchSet.chosenIndex] ?? pitchSet.pitches[0]!;
  writeJson(path.join(episodeDir(beat.episode), "pitches.json"), pitchSet);
  log.info(`Plot Writer chose: ${pitch.logline.slice(0, 100)}…`);

  const MAX_DRAFTS = 3;
  let script: EpisodeScript | null = null;
  let review: ScriptReview | null = null;
  let critique = "";
  for (let attempt = 1; attempt <= MAX_DRAFTS; attempt++) {
    const draft = await generateStructured({
      item: `episode-${beat.episode}-script${attempt > 1 ? `-rev${attempt}` : ""}`,
      prompt: episodePrompt(bible, cast, state, beat, pitch) + critique,
      schema: episodeScriptSchema,
      mock: () => writeEpisodeScriptMock(beat, cast, state),
      tracker,
    });
    const draftReview = await reviewScript({ script: draft, bible, cast, tracker });
    if (!script || !review || scoreAvg(draftReview) > scoreAvg(review)) {
      script = draft;
      review = draftReview;
    }
    const qr = loadQualityReport(beat.episode);
    qr.script = { ...(review ?? draftReview), iterations: attempt };
    saveQualityReport(qr);
    if (scriptReviewPasses(draftReview)) break;
    log.warn(
      `Quality Director: draft ${attempt} below the bar (${draftReview.topProblems.join(" | ")}) — revising`,
    );
    critique =
      `\n\nYOUR PREVIOUS DRAFT WAS REJECTED by the Quality Director. Problems:\n` +
      draftReview.topProblems.map((p) => `- ${p}`).join("\n") +
      `\nApply these fixes exactly:\n` +
      draftReview.concreteFixes.map((f) => `- ${f}`).join("\n");
  }
  if (!script) throw new Error("episode generation produced no script");
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
