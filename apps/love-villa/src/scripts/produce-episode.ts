import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
import { renderEpisodeVideo, renderSceneStill, resetBundleCache } from "../render/render";
import { editImageWithReferences } from "../providers/images/openai";
import { cameraDirection, framingDirection, palindromify } from "../staff/videographer";
import { motionDirection } from "../staff/animator";
import {
  loadQualityReport,
  reviewAudio,
  reviewVisuals,
  saveQualityReport,
} from "../quality/quality-director";
import { loadShowBible } from "../show/show-bible";
import { parseArgs, intArg } from "../utils/args";
import { CostTracker } from "../utils/cost";
import { ensureDir, episodeId, writeJson } from "../utils/fs";
import { log } from "../utils/log";
import { wavDurationSeconds } from "../utils/wav";

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
      // Voice lines are paid assets like clips: reuse existing takes instead
      // of re-billing on every produce run (delete a file to re-record it).
      const existingAudio = findExistingAsset(
        assetRel("episodes", epId, "audio", `s${scene.index}-l${li}`),
        ["mp3", "wav"],
      );
      if (env.REUSE_EXISTING_ASSETS && existingAudio) {
        const buf = readFileSync(assetAbs(existingAudio));
        let seconds: number;
        if (existingAudio.endsWith(".wav")) {
          seconds = wavDurationSeconds(buf);
        } else {
          const { parseBuffer } = await import("music-metadata");
          const meta = await parseBuffer(new Uint8Array(buf), { mimeType: "audio/mpeg" });
          seconds = meta.format.duration ?? line.text.length / 14;
        }
        manifest.lines.push({ scene: scene.index, line: li, file: existingAudio, seconds });
        continue;
      }
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

  log.step("Quality Director — audio check");
  const audioFindings = reviewAudio(episode);
  {
    const qr = loadQualityReport(episode);
    qr.audio = { findings: audioFindings, checkedAt: new Date().toISOString() };
    saveQualityReport(qr);
  }
  const audioCritical = audioFindings.filter((f) => f.severity === "critical");
  for (const f of audioFindings) {
    (f.severity === "critical" ? log.warn : log.info)(`[audio] ${f.file}: ${f.issue}`);
  }
  if (audioCritical.length > 0) {
    throw new Error(
      `Quality Director rejected ${audioCritical.length} voice line(s) — regenerate before continuing.`,
    );
  }
  log.ok("audio passes");

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
      // Reuse an already-generated clip (paid asset) instead of re-billing.
      const existingClip = assetRel("episodes", epId, "clips", `s${planScene.index}.mp4`);
      if (env.REUSE_EXISTING_ASSETS && existsSync(assetAbs(existingClip))) {
        planScene.clipFile = existingClip;
        // Clips are stored as palindromes (Videographer) — double duration.
        planScene.clipDurationFrames = Math.round(2 * env.MOTION_CLIP_SECONDS * plan.fps);
        log.info(`scene ${planScene.index + 1}: reusing existing clip`);
        continue;
      }
      try {
        tracker.charge({
          provider: motion.key,
          item: `motion:scene-${planScene.index}`,
          estimatedUsd: env.MOTION_COST_PER_CLIP_USD,
          mode: "live",
        });
        const stillFile = assetAbs(assetRel("episodes", epId, "stills", `s${planScene.index}.png`));
        ensureDir(path.dirname(stillFile));
        // Videographer: painted scene still — characters rendered INTO the
        // environment with reference images (Directive 3). Falls back to the
        // legacy cutout composite on failure.
        let stillMade = false;
        if (env.OPENAI_API_KEY && scriptScene) {
          try {
            const loc = bible.villa.locations.find((l) => l.id === scriptScene.locationId);
            // Focal casting (QD rounds 1-3 finding): the image model produces
            // duplicated people, identity blends, and fused limbs whenever a
            // frame holds 4+ characters. Paint only the first 3 characters of
            // the scene roster (the script orders them by importance);
            // everyone else stays off-camera, reality-TV style.
            const paintCast = scriptScene.characters.slice(0, 3);
            const refs: Buffer[] = [];
            const locRef = findExistingAsset(assetRel("locations", scriptScene.locationId), [
              "png",
            ]);
            if (locRef) refs.push(readFileSync(assetAbs(locRef)));
            for (const id of paintCast) {
              const cRef = findExistingAsset(assetRel("characters", id), ["png"]);
              if (cRef) refs.push(readFileSync(assetAbs(cRef)));
            }
            const paintNames = paintCast
              .map((id) => cast.find((c) => c.id === id)?.fullName.split(" ")[0] ?? id)
              .join(", ");
            const looks = paintCast
              .map((id) => cast.find((c) => c.id === id)?.visualReference)
              .filter(Boolean)
              .join("; ");
            tracker.charge({
              provider: "openai",
              item: `scene-still:${planScene.index}`,
              estimatedUsd: 0.25,
              mode: "live",
            });
            const painted = await editImageWithReferences({
              prompt: [
                `${scriptScene.visual}.`,
                framingDirection(scriptScene),
                `Paint the referenced characters INTO the referenced ${loc?.name ?? "villa"} ` +
                  `environment as ONE unified scene: correct relative scale, believable contact ` +
                  `shadows, lighting matched to the environment's ${loc?.timeOfDay ?? "day"} key light.`,
                `Character designs must match the references EXACTLY (faces, hair, flag outfits, ` +
                  `signature accessories like eyewear/hats/scarves — never swap or restyle them): ${looks}.`,
                `EXACTLY ${paintCast.length} people in frame — ONLY ${paintNames}, and each of ` +
                  `them appears EXACTLY ONCE (never two copies of the same person). Every other ` +
                  `character mentioned in the scene description is OFF-CAMERA (tight reality-TV ` +
                  `framing), and the background contains NO people at all — empty loungers, empty ` +
                  `pool, empty seats. Every character is an ADULT with the same adult proportions ` +
                  `as their reference; no child-sized bodies.`,
                "Stage the characters with CLEAR SEPARATION: bodies never overlap or interlock; " +
                  "any physical contact is minimal (a hand on a shoulder at most) with both " +
                  "people's arms fully visible and unmistakably attached to their own bodies. " +
                  "Minimal set dressing: never duplicate a furniture item, one clean silhouette " +
                  "per bed/table/lamp, and everything rests on a real surface.",
                "Hands must be anatomically correct with five clearly separated fingers; every " +
                  "held object fully resolved and physically supported; no floating, merged, or " +
                  "half-formed props; every hand and arm attaches to a visible body — no " +
                  "disembodied limbs; flames only inside a fire pit, torch sconce, or lamp.",
                "Ultra-glossy stylized chunky 3D render matching the character references' style " +
                  "exactly (NOT painterly, NOT semi-realistic), candy-bright saturated palette even " +
                  "in night scenes (moonlit teal with warm accents, never grey), vertical 9:16 " +
                  "composition, no text, no watermark.",
              ].join(" "),
              references: refs,
              quality: "max",
            });
            writeFileSync(stillFile, painted.data);
            stillMade = true;
            log.ok(`scene ${planScene.index + 1}: painted still (Videographer)`);
          } catch (err) {
            log.warn(
              `scene ${planScene.index + 1}: painted still failed (${err instanceof Error ? err.message.slice(0, 120) : err}) — cutout fallback`,
            );
          }
        }
        if (!stillMade) await renderSceneStill(plan, planScene.index, stillFile);
        const clip = await motion.imageToVideo({
          image: readFileSync(stillFile),
          prompt:
            `${scriptScene?.visual ?? "villa scene"}. ` +
            (scriptScene
              ? `${motionDirection(scriptScene)} ${cameraDirection(scriptScene)} `
              : "") +
            `STRICT CONSISTENCY: preserve every character's exact face, body proportions, outfit, ` +
            `colors and position from the image — no redesign, no morphing, no new clothing items ` +
            `or accessories, no flags other than those already present; keep the exact glossy ` +
            `animated reality-show art style and color grading of the image; no text.`,
          seconds: env.MOTION_CLIP_SECONDS,
        });
        if (clip) {
          const rel = assetRel("episodes", epId, "clips", `s${planScene.index}.${clip.ext}`);
          ensureDir(path.dirname(assetAbs(rel)));
          writeFileSync(assetAbs(rel), clip.data);
          // Videographer: palindrome the clip so looping never snaps back.
          palindromify(assetAbs(rel));
          planScene.clipFile = rel;
          planScene.clipDurationFrames = Math.round(2 * env.MOTION_CLIP_SECONDS * plan.fps);
          log.ok(`scene ${planScene.index + 1} animated → assets/${rel}`);
        }
      } catch (err) {
        manifest.failures.push(
          `motion:scene-${planScene.index}: ${err instanceof Error ? err.message : String(err)} (falling back to camera move)`,
        );
        log.warn(`scene ${planScene.index + 1} motion failed — camera-move fallback`);
      }
    }
    // New clip files exist now — the cached bundle snapshotted assets without them.
    resetBundleCache();
  }

  writeJson(path.join(ASSETS_DIR, "episodes", epId, "render-plan.json"), plan);
  writeJson(path.join(DATA_DIR, "episodes", epId, "assets.json"), manifest);
  log.ok(
    `render plan: ${plan.scenes.length} scenes · ${(plan.durationFrames / plan.fps).toFixed(1)}s total`,
  );

  // Quality Director — visual pass over the scene stills (one vision call).
  const stillsDir = assetAbs(assetRel("episodes", epId, "stills"));
  if (existsSync(stillsDir)) {
    log.step("Quality Director — visual check");
    const stills = readdirSync(stillsDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .slice(0, 8)
      .map((f) => ({ label: `still:${f}`, file: path.join(stillsDir, f) }));
    if (stills.length > 0) {
      const visual = await reviewVisuals({ episode, images: stills, tracker });
      const qr = loadQualityReport(episode);
      qr.visuals = [{ ...visual, checkedAt: new Date().toISOString() }];
      saveQualityReport(qr);
      const critical = visual.images.filter((i) => i.severity === "critical");
      for (const img of visual.images) {
        if (img.severity !== "ok") {
          const label = visual.labels[img.index] ?? `img${img.index}`;
          (img.severity === "critical" ? log.warn : log.info)(
            `[visual] ${label}: ${img.aiDefects.join("; ") || img.notes}`,
          );
        }
      }
      if (critical.length > 0) {
        log.warn(
          `Quality Director flagged ${critical.length} still(s) CRITICAL — regenerate those scenes ` +
            `before approving the rough cut (validate-episode will refuse to pass).`,
        );
      } else {
        log.ok("visuals pass");
      }
    }
  }

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
