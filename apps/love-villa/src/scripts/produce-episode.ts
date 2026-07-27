import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { requireApproved, setApproval } from "../approvals/approvals";
import { characterById, loadCast } from "../characters/character-manager";
import { ASSETS_DIR, DATA_DIR, OUTPUT_DIR, loadConfig } from "../config";
import { loadEpisodeScript } from "../episodes/episode-generator";
import { characterImage, locationImage } from "../providers/images";
import { getMusicProvider } from "../providers/music";
import { getMotionProvider } from "../providers/video";
import { speakLine } from "../providers/tts";
import {
  assetAbs,
  assetRel,
  buildRenderPlan,
  findExistingAsset,
  type LineAudioInfo,
} from "../render/render-plan";
import { renderEpisodeVideo, renderSceneStill } from "../render/render";
import { loadShowBible } from "../show/show-bible";
import { parseArgs, intArg } from "../utils/args";
import { CostTracker } from "../utils/cost";
import { ensureDir, episodeId, writeJson } from "../utils/fs";
import { log } from "../utils/log";

export interface AssetManifest {
  episode: number;
  characters: Record<string, string>;
  locations: Record<string, string>;
  lines: LineAudioInfo[];
  music: string;
  failures: string[];
  regenerated: string[];
}

/**
 * npm run produce-episode -- --episode 1
 *
 * Generates or collects every asset the episode needs (character cutouts,
 * location backgrounds, per-line voice audio, music bed, SFX), builds the
 * timed render plan from real audio durations, and renders a half-resolution
 * draft for the rough-cut review gate.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = intArg(args, "episode");
  const force = args.force === true;
  const skipDraft = args["skip-draft"] === true;

  requireApproved("script", episode, force);
  requireApproved("visual-prompts", episode, force);

  const env = loadConfig();
  const bible = loadShowBible();
  const cast = loadCast();
  const script = loadEpisodeScript(episode);
  const tracker = new CostTracker({ episode });
  const epId = episodeId(episode);
  const manifest: AssetManifest = {
    episode,
    characters: {},
    locations: {},
    lines: [],
    music: "",
    failures: [],
    regenerated: [],
  };

  const neededCharacters = new Set(script.scenes.flatMap((s) => s.characters));
  const neededLocations = new Set(script.scenes.map((s) => s.locationId));

  log.step(`Producing episode ${episode}: assets`);
  let imageCount = 0;
  for (const id of neededCharacters) {
    const existing = findExistingAsset(assetRel("characters", id), ["png", "svg"]);
    if (existing && env.REUSE_EXISTING_ASSETS) {
      manifest.characters[id] = existing;
      continue;
    }
    if (imageCount >= env.MAX_IMAGES_PER_EPISODE) {
      manifest.failures.push(`character:${id} skipped — MAX_IMAGES_PER_EPISODE reached`);
      continue;
    }
    try {
      const img = await characterImage(characterById(cast, id), tracker, env.IMAGE_QUALITY);
      const rel = assetRel("characters", `${id}.${img.ext}`);
      ensureDir(path.dirname(assetAbs(rel)));
      writeFileSync(assetAbs(rel), img.data);
      manifest.characters[id] = rel;
      if (existing) manifest.regenerated.push(rel);
      imageCount++;
    } catch (err) {
      manifest.failures.push(
        `character:${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  for (const id of neededLocations) {
    const existing = findExistingAsset(assetRel("locations", id), ["png", "svg"]);
    if (existing && env.REUSE_EXISTING_ASSETS) {
      manifest.locations[id] = existing;
      continue;
    }
    if (imageCount >= env.MAX_IMAGES_PER_EPISODE) {
      manifest.failures.push(`location:${id} skipped — MAX_IMAGES_PER_EPISODE reached`);
      continue;
    }
    const loc = bible.villa.locations.find((l) => l.id === id);
    if (!loc) {
      manifest.failures.push(`location:${id}: unknown location`);
      continue;
    }
    try {
      const img = await locationImage(loc, tracker, env.IMAGE_QUALITY);
      const rel = assetRel("locations", `${id}.${img.ext}`);
      ensureDir(path.dirname(assetAbs(rel)));
      writeFileSync(assetAbs(rel), img.data);
      manifest.locations[id] = rel;
      if (existing) manifest.regenerated.push(rel);
      imageCount++;
    } catch (err) {
      manifest.failures.push(`location:${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  log.ok(
    `images ready (${Object.keys(manifest.characters).length} characters, ${Object.keys(manifest.locations).length} locations)`,
  );

  log.step("Voice lines");
  for (const scene of script.scenes) {
    for (let li = 0; li < scene.lines.length; li++) {
      const line = scene.lines[li]!;
      const character = characterById(cast, line.speaker);
      const seed = episode * 100000 + scene.index * 100 + li;
      let attempt = 0;
      let done = false;
      while (!done) {
        try {
          const speech = await speakLine(
            { text: line.text, character, delivery: line.delivery, seed },
            tracker,
          );
          const rel = assetRel("episodes", epId, "audio", `s${scene.index}-l${li}.${speech.ext}`);
          ensureDir(path.dirname(assetAbs(rel)));
          writeFileSync(assetAbs(rel), speech.data);
          manifest.lines.push({ scene: scene.index, line: li, file: rel, seconds: speech.seconds });
          if (attempt > 0) manifest.regenerated.push(rel);
          done = true;
        } catch (err) {
          attempt++;
          if (attempt > env.MAX_TTS_REGENS_PER_LINE) {
            throw new Error(
              `TTS failed for scene ${scene.index} line ${li} after ${attempt} attempts: ` +
                `${err instanceof Error ? err.message : String(err)}`,
            );
          }
          log.warn(`TTS retry ${attempt} for scene ${scene.index} line ${li}`);
        }
      }
    }
  }
  log.ok(`${manifest.lines.length} voice lines`);

  log.step("Music bed (generated, royalty-free)");
  const speech = manifest.lines.reduce((s, l) => s + l.seconds, 0);
  const estimated = speech + script.scenes.length * 1.6 + 8;
  const music = await getMusicProvider().musicBed(estimated);
  const musicRel = assetRel("episodes", epId, "music-bed.wav");
  ensureDir(path.dirname(assetAbs(musicRel)));
  writeFileSync(assetAbs(musicRel), music.data);
  manifest.music = musicRel;

  log.step("Render plan");
  const plan = buildRenderPlan({
    script,
    bible,
    cast,
    lineAudio: manifest.lines,
    musicFile: musicRel,
  });

  // True animation pass (image-to-video): render a clean-plate still of each
  // scene and animate it through the motion provider. Hook and twist scenes
  // first — they carry the episode. Failures fall back to camera moves.
  const motion = getMotionProvider();
  if (motion.enabled && env.MAX_VIDEO_GENS_PER_EPISODE > 0) {
    log.step(`Animating scenes via ${motion.key} (${env.FAL_I2V_MODEL})`);
    const priority = (s: (typeof plan.scenes)[number]): number =>
      s.slot === "hook" ? 0 : s.slot === "twist" ? 1 : s.slot === "setup" ? 2 : 3;
    const candidates = plan.scenes
      .filter((s) => s.kind !== "endcard")
      .sort((a, b) => priority(a) - priority(b))
      .slice(0, env.MAX_VIDEO_GENS_PER_EPISODE);
    for (const planScene of candidates) {
      const scriptScene = script.scenes.find((s) => s.index === planScene.index);
      try {
        tracker.charge({
          provider: motion.key,
          item: `motion:scene-${planScene.index}`,
          estimatedUsd: env.MOTION_COST_PER_CLIP_USD,
          mode: "live",
        });
        const stillFile = assetAbs(assetRel("episodes", epId, "stills", `s${planScene.index}.png`));
        await renderSceneStill(plan, planScene.index, stillFile);
        const clip = await motion.imageToVideo({
          image: readFileSync(stillFile),
          prompt:
            `${scriptScene?.visual ?? "villa scene"}. Gentle expressive character animation: they ` +
            `blink, breathe, gesture and react naturally; subtle cloth and hair movement; slow ` +
            `cinematic camera; keep the exact glossy animated reality-show art style and character ` +
            `designs of the image; no text, no morphing.`,
          seconds: env.MOTION_CLIP_SECONDS,
        });
        if (clip) {
          const rel = assetRel("episodes", epId, "clips", `s${planScene.index}.${clip.ext}`);
          ensureDir(path.dirname(assetAbs(rel)));
          writeFileSync(assetAbs(rel), clip.data);
          planScene.clipFile = rel;
          planScene.clipDurationFrames = Math.round(env.MOTION_CLIP_SECONDS * plan.fps);
          log.ok(`scene ${planScene.index + 1} animated → assets/${rel}`);
        }
      } catch (err) {
        manifest.failures.push(
          `motion:scene-${planScene.index}: ${err instanceof Error ? err.message : String(err)} (falling back to camera move)`,
        );
        log.warn(`scene ${planScene.index + 1} motion failed — camera-move fallback`);
      }
    }
  }

  writeJson(path.join(ASSETS_DIR, "episodes", epId, "render-plan.json"), plan);
  writeJson(path.join(DATA_DIR, "episodes", epId, "assets.json"), manifest);
  log.ok(
    `render plan: ${plan.scenes.length} scenes · ${(plan.durationFrames / plan.fps).toFixed(1)}s total`,
  );

  if (!skipDraft) {
    log.step("Draft render (rough cut, half resolution)");
    const draftFile = path.join(OUTPUT_DIR, "episodes", epId, "draft.mp4");
    const result = await renderEpisodeVideo({ plan, outFile: draftFile, draft: true });
    log.ok(`${draftFile} (${result.seconds.toFixed(1)}s)`);
  }

  setApproval("rough-cut", episode, "pending", `Review output/episodes/${epId}/draft.mp4`);
  log.info(`ledger: $${tracker.totalUsd.toFixed(2)} (budget $${env.MAX_COST_PER_EPISODE_USD})`);
  log.info(`Next: npm run approve -- --stage rough-cut --episode ${episode}`);
  log.info(`Then: npm run render-episode -- --episode ${episode}`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
