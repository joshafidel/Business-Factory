import path from "node:path";
import { existsSync } from "node:fs";
import { isNarrator, NARRATOR } from "../ai/narrator";
import { type Character, type EpisodeScript, type ShowBible } from "../ai/schemas";
import { ASSETS_DIR } from "../config";
import { episodeId, readJsonIfExists } from "../utils/fs";

/**
 * The RenderPlan is the single JSON contract between the pipeline and the
 * Remotion composition: every file reference is relative to assets/ (the
 * Remotion public dir), and every timing is in frames at plan.fps.
 */

export {
  FPS,
  WIDTH,
  HEIGHT,
  type PlanCharacter,
  type PlanLine,
  type PlanScene,
  type PlanSfx,
  type RenderPlan,
} from "./plan-types";
import {
  FPS,
  HEIGHT,
  WIDTH,
  type PlanCharacter,
  type PlanLine,
  type PlanScene,
  type PlanSfx,
  type RenderPlan,
} from "./plan-types";

export interface LineAudioInfo {
  scene: number;
  line: number;
  file: string; // relative to assets/
  seconds: number;
}

const LEAD_IN_S = 0.35;
const LINE_GAP_S = 0.16;
const TAIL_S = 0.45;

export function assetRel(...parts: string[]): string {
  return parts.join("/");
}

export function assetAbs(rel: string): string {
  return path.join(ASSETS_DIR, rel);
}

/** Find a previously generated asset regardless of extension (svg vs png). */
export function findExistingAsset(relBase: string, exts: string[]): string | null {
  for (const ext of exts) {
    const rel = `${relBase}.${ext}`;
    if (existsSync(assetAbs(rel))) return rel;
  }
  return null;
}

export function buildRenderPlan(params: {
  script: EpisodeScript;
  bible: ShowBible;
  cast: Character[];
  lineAudio: LineAudioInfo[];
  musicFile: string;
}): RenderPlan {
  const { script, bible, cast, lineAudio, musicFile } = params;
  const byId = new Map(cast.map((c) => [c.id, c]));
  const audioOf = (scene: number, line: number): LineAudioInfo => {
    const found = lineAudio.find((a) => a.scene === scene && a.line === line);
    if (!found) throw new Error(`Missing line audio for scene ${scene} line ${line}`);
    return found;
  };

  let cursor = 0;
  const scenes: PlanScene[] = script.scenes.map((scene) => {
    const startFrame = cursor;
    let offset = Math.round(LEAD_IN_S * FPS);
    const lines: PlanLine[] = scene.lines.map((l, li) => {
      const audio = audioOf(scene.index, li);
      const c = isNarrator(l.speaker) ? NARRATOR : byId.get(l.speaker);
      const durationFrames = Math.ceil(audio.seconds * FPS);
      const planLine: PlanLine = {
        speaker: l.speaker,
        speakerName: isNarrator(l.speaker)
          ? "Narrator"
          : c
            ? (c.fullName.split(" ")[0] ?? l.speaker)
            : l.speaker,
        color: c?.palette.accent ?? "#ffffff",
        text: l.text,
        emphasize: l.emphasize,
        audioFile: audio.file,
        startFrame: offset,
        durationFrames,
      };
      offset += durationFrames + Math.round(LINE_GAP_S * FPS);
      return planLine;
    });
    const isEndcard = scene.kind === "endcard";
    const bodyFrames = isEndcard ? Math.round(3.6 * FPS) : offset + Math.round(TAIL_S * FPS);
    const durationFrames = Math.max(Math.round(2.2 * FPS), bodyFrames);

    const loc = bible.villa.locations.find((l) => l.id === scene.locationId);
    const background =
      findExistingAsset(assetRel("locations", scene.locationId), ["png", "svg"]) ??
      assetRel("locations", `${scene.locationId}.svg`);

    const characters: PlanCharacter[] = scene.characters.map((id, i) => {
      const c = byId.get(id);
      const file =
        findExistingAsset(assetRel("characters", id), ["png", "svg"]) ??
        assetRel("characters", `${id}.svg`);
      const position = scene.characters.length === 1 ? 2 : i === 0 ? 0 : i === 1 ? 1 : 2;
      return { id, name: c?.fullName.split(" ")[0] ?? id, file, position };
    });

    const sfx: PlanSfx[] = scene.sfx.map((kind, i) => ({
      kind,
      file: assetRel("sfx", `${kind}.wav`),
      atFrame: i === 0 ? 0 : Math.round(durationFrames * 0.5),
    }));

    cursor += durationFrames;
    return {
      index: scene.index,
      slot: scene.slot,
      kind: scene.kind,
      motion: scene.motion,
      startFrame,
      durationFrames,
      background,
      timeOfDay: loc?.timeOfDay ?? "day",
      characters,
      lines,
      sfx,
      textMessages: scene.textMessages,
      endcardText: isEndcard ? engagementText(script) : undefined,
    };
  });

  const hookText = script.scenes[0]?.lines[0]?.text ?? script.title;
  return {
    episode: script.episode,
    title: script.title,
    hookText,
    fps: FPS,
    width: WIDTH,
    height: HEIGHT,
    durationFrames: cursor,
    music: { file: musicFile, volume: 0.26 },
    scenes,
  };
}

function engagementText(script: EpisodeScript): string {
  // The engagement text lives in the caption's tail for authored scripts;
  // prefer an explicit endcard visual if present.
  const endcard = script.scenes.find((s) => s.kind === "endcard");
  if (endcard && endcard.visual.includes(":")) {
    const after = endcard.visual.split(":").slice(1).join(":").trim();
    if (after.length > 8) return after;
  }
  return script.caption;
}

export function loadRenderPlan(episode: number): RenderPlan {
  const file = path.join(ASSETS_DIR, "episodes", episodeId(episode), "render-plan.json");
  const plan = readJsonIfExists<RenderPlan>(file);
  if (!plan) {
    throw new Error(
      `No render plan at ${file}. Run: npm run produce-episode -- --episode ${episode}`,
    );
  }
  return plan;
}
