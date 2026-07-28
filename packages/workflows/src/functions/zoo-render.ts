import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordCost } from "@bf/agents";
import { loadEnv } from "@bf/config";
import { prisma, type Prisma } from "@bf/database";
import {
  getMediaProviders,
  getMotionProvider,
  awaitMotionJobs,
  withMotionGuardrails,
  type MediaResult,
} from "@bf/providers";
import { getStorage } from "@bf/storage";
import { castLooks, createLogger, PlatformError, signAssetToken } from "@bf/shared";
import { registerCodeFunction, readPath } from "../definitions";
import { analyzeBeats, beatAlignedDurations } from "./beat-map";
import { ensureCastRefs, refsFor, type CastRefs } from "./zoo-cast-refs";
import { mp3DurationSeconds, pcmToWav, publicBaseUrl, resolveFfmpeg } from "./media-utils";

const log = createLogger("zoo-render");

/**
 * Zoo Shorts rendering, split across two workflow steps so each gets its own
 * serverless invocation (Higgsfield needs ~3-4 minutes per clip):
 *
 *  1. "render" (render_zoo_short): scene illustrations (gpt-image, parallel),
 *     the sung voice-over (gpt-4o-mini-tts), and — when Higgsfield keys plus a
 *     public base URL are configured — submits one image-to-video job per
 *     scene so the stills become true animated shots.
 *  2. "assemble" (assemble_zoo_video): waits for the animation jobs, downloads
 *     finished clips, falls back to Ken Burns for any scene whose clip isn't
 *     ready, and cuts the final 1080x1920 MP4 with crossfades, the voice-over,
 *     and a synthesized music-box bed.
 *
 * Without OPENAI_API_KEY the mocks keep the pipeline alive and the video is
 * flagged placeholder (never uploaded).
 */

interface ZooScene {
  /** Sung lyric lines for this scene (song episodes). */
  lyrics?: string;
  /** Spoken fallback text (pre-song episodes / TTS mode). */
  narration?: string;
  visual?: string;
  /** Cast member names appearing in this scene (see ZOO_CAST). */
  characters?: string[];
  /** "verse" | "chorus" — used to structure the song. */
  type?: string;
  /** Choreography (Animation 2.0): one clear action per scene. */
  action?: {
    /** Small windup before the action ("Ellie crouches slightly"). */
    anticipation?: string;
    /** The main readable action ("she jumps into the puddle with a splash"). */
    main?: string;
    /** Follow-through / settle ("she giggles and wiggles her ears"). */
    settle?: string;
    /** What the characters look at ("each other", "the red bucket"). */
    gaze?: string;
  };
}

/** Compile a scene's choreography into a motion prompt for the i2v model. */
function motionPrompt(scene: ZooScene | undefined): string {
  const a = scene?.action;
  if (a?.main) {
    const parts = [
      a.anticipation ? `First ${a.anticipation}.` : "",
      `Then ${a.main}.`,
      a.settle ? `Finally ${a.settle}.` : "",
      a.gaze ? `The characters look at ${a.gaze}.` : "",
    ].filter(Boolean);
    return withMotionGuardrails(
      `Toddler-cartoon animation, slow clear movements with gentle anticipation and settle: ${parts.join(" ")} ` +
        "Soft secondary motion (ears, tails). Slow smooth cinematic camera.",
    );
  }
  const motion = (scene?.visual ?? "a happy baby zoo animal").slice(0, 300);
  return withMotionGuardrails(
    `Gentle toddler-cartoon animation: ${motion}. The cute baby animals move softly and ` +
      "expressively — they blink, bounce to the music, wiggle ears, smile at each other. " +
      "Slow smooth cinematic camera, subtle motion.",
  );
}

registerCodeFunction("render_zoo_short", async (args, context) => {
  const organizationId = String(args.organizationId ?? "");
  const workflowRunId = String(args.workflowRunId ?? "");
  const script = readPath(context, "$.steps.script") as {
    scenes?: ZooScene[];
    outro?: string;
  };
  const metadata = readPath(context, "$.steps.metadata") as { title?: string };
  const scenes = (script?.scenes ?? []).slice(0, 8);
  const title = metadata?.title ?? "Zoo short";
  const providers = getMediaProviders();
  const storage = getStorage();

  const assetIds: string[] = [];
  let totalCost = 0n;
  const save = async (
    name: string,
    type: "IMAGE" | "AUDIO" | "VIDEO",
    mimeType: string,
    data: Buffer,
    meta: Record<string, unknown>,
  ): Promise<string> => {
    const key = `${organizationId}/${workflowRunId}/${type.toLowerCase()}-${assetIds.length}-${Date.now()}`;
    const stored = await storage.put(key, data, { contentType: mimeType });
    const asset = await prisma.asset.create({
      data: {
        organizationId,
        name,
        type,
        mimeType,
        storageDriver: storage.driver,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        moduleKey: "kids-shorts",
        workflowRunId,
        source: "workflow:zoo-shorts-pipeline:render",
        approvalStatus: "PENDING_REVIEW",
        metadata: meta as Prisma.InputJsonValue,
      },
    });
    assetIds.push(asset.id);
    return asset.id;
  };

  // Canonical character references (Animation 2.0): generated once, stored
  // versioned, and used to CONDITION every scene still via image edits so
  // the cast stays pixel-consistent across shots and episodes.
  let castRefs: CastRefs | null = null;
  const imageWithEdit = providers.image as typeof providers.image & {
    editImage?: (p: { prompt: string; references: Buffer[] }) => Promise<MediaResult>;
  };
  if (providers.real && typeof imageWithEdit.editImage === "function") {
    try {
      castRefs = await ensureCastRefs(organizationId, storage, providers.image);
      totalCost += castRefs.costMicroUsd;
    } catch (err) {
      log.warn({ err }, "cast reference generation failed; falling back to text-only stills");
    }
  }

  // Scene images — parallel; serverless wall-clock matters. Reference-
  // conditioned edits when available; verbatim look-lines as belt & braces.
  const style =
    "Soft rounded shapes, pastel rainbow colors, glossy 3D toddler-animation style like modern " +
    "nursery rhyme cartoons, huge sparkly eyes, soft cinematic lighting, cheerful sunny zoo " +
    "playground background, no text, no words, no letters";
  const images = await Promise.all(
    scenes.map((scene, i) => {
      const looks = castLooks(scene?.characters ?? []);
      const castLine =
        looks.length > 0 ? ` Characters (keep these exact designs): ${looks.join("; ")}.` : "";
      const prompt = `${scene?.visual ?? "happy zoo animal"}.${castLine} ${style}`;
      const refs = castRefs ? refsFor(castRefs, scene?.characters ?? []) : [];
      const gen =
        refs.length > 0 && imageWithEdit.editImage
          ? imageWithEdit.editImage({
              prompt:
                `Compose this scene using the EXACT characters from the reference images — ` +
                `identical designs, colors and proportions: ${prompt}`,
              references: refs,
            })
          : providers.image.generateImage({ prompt });
      return gen.then((r) => ({ i, r }));
    }),
  );
  const imageAssetIds: string[] = [];
  for (const { i, r } of images.sort((a, b) => a.i - b.i)) {
    totalCost += r.costMicroUsd;
    const id = await save(
      `Scene ${i + 1}: ${(scenes[i]?.visual ?? "").slice(0, 60)}`,
      "IMAGE",
      r.mimeType,
      r.data,
      { sceneIndex: i, visual: scenes[i]?.visual, provider: providers.image.key },
    );
    imageAssetIds.push(id);
  }

  // Audio track. Two modes:
  //  - SONG (Eleven Music configured + script has lyrics): a real sung
  //    nursery-rhyme with vocals — the Cocomelon formula. The song is the
  //    entire soundtrack; no synth bed is layered underneath.
  //  - NARRATION fallback: warm sung-style TTS + the synth music-box bed.
  const sceneTexts = scenes.map((s) => s?.lyrics ?? s?.narration ?? "");
  const hasLyrics = scenes.some((s) => Boolean(s?.lyrics));
  let audioKind: "song" | "narration" = "narration";
  let audio: { data: Buffer; mimeType: string; costMicroUsd: bigint };
  let audioMeta: Record<string, unknown>;
  if (providers.music && hasLyrics) {
    const lyricSheet = scenes
      .map((s, i) => `[${s?.type === "chorus" ? "chorus" : `verse ${i + 1}`}]\n${s?.lyrics ?? ""}`)
      .concat(script?.outro ? [`[outro]\n${script.outro}`] : [])
      .join("\n\n");
    // ~8.5s of song per scene keeps scenes long enough for the animation.
    const lengthMs = Math.max(45_000, Math.min(120_000, scenes.length * 8_500 + 6_000));
    const song = await providers.music.generateMusic({
      prompt:
        "A joyful children's nursery rhyme song for toddlers (ages 1-4), sung by a warm, sweet, " +
        "playful female voice with a gentle kids' choir echoing the chorus. Simple ultra-catchy " +
        "melody that repeats, bouncy but soft: ukulele, glockenspiel, marimba, light hand-claps, " +
        "soft drums. Around 95 BPM, C major, bright and happy, clean mix, toddler-friendly. " +
        `Sing these lyrics exactly:\n\n${lyricSheet}`,
      lengthMs,
    });
    audioKind = "song";
    audio = song;
    audioMeta = { provider: "elevenlabs-music", kind: "song", lengthMs };
  } else {
    const narration = [...sceneTexts, script?.outro ?? ""].filter(Boolean).join(" ");
    const voice = await providers.audio.generateSpeech({
      text: narration,
      style:
        "You are a young mom singing a nursery rhyme to your own toddler, smiling the whole time. " +
        "Upbeat, happy, bouncy and melodic — a true sing-song children's-rhyme delivery with natural " +
        "human breaths, warm affectionate tone, playful emphasis on animal sounds and repeated words. " +
        "Slightly slower pace for little ears. Sound genuinely delighted and loving, never flat, " +
        "never robotic, never like a synthetic narrator.",
    });
    audio = voice;
    audioMeta = { provider: providers.audio.key, kind: "narration", chars: narration.length };
  }
  totalCost += audio.costMicroUsd;
  const audioAssetId = await save(
    `${audioKind === "song" ? "Song" : "Voice-over"}: ${title.slice(0, 60)}`,
    "AUDIO",
    audio.mimeType,
    audio.data,
    audioMeta,
  );
  const audioSeconds = await mp3DurationSeconds(audio.data, sceneTexts.join(" ").length || 600);

  // Submit Higgsfield image-to-video jobs (the next step polls + assembles).
  // Requires a public base URL so their fetcher can download the images.
  //
  // The account allows only 4 concurrent generations — submitting more
  // bounces with a 400 and stacks nothing. So animate the 4 highest-impact
  // scenes (opening hook, choruses, finale) and let the rest use Ken Burns;
  // it also halves the per-video animation cost.
  const MAX_ANIMATED_SCENES = 4;
  const animationJobs: { sceneIndex: number; jobSetId: string }[] = [];
  let submissionsFailed = 0;
  const base = publicBaseUrl();
  const motion = getMotionProvider();
  if (providers.real && motion && base && imageAssetIds.length > 0) {
    const priority: number[] = [];
    const addIdx = (i: number): void => {
      if (i >= 0 && i < imageAssetIds.length && !priority.includes(i)) priority.push(i);
    };
    addIdx(0);
    scenes.forEach((s, i) => {
      if (s?.type === "chorus") addIdx(i);
    });
    addIdx(imageAssetIds.length - 1);
    scenes.forEach((_, i) => addIdx(i));
    const toAnimate = priority.slice(0, MAX_ANIMATED_SCENES);

    const env = loadEnv();
    const exp = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
    const submissions = await Promise.allSettled(
      toAnimate.map(async (i) => {
        const assetId = imageAssetIds[i] as string;
        const sig = signAssetToken(env.SECRET_ENCRYPTION_KEY, assetId, exp);
        const imageUrl = `${base}/api/assets/public?id=${assetId}&exp=${exp}&sig=${sig}`;
        const jobSetId = await motion.submit({
          imageUrl,
          prompt: motionPrompt(scenes[i]),
        });
        return { sceneIndex: i, jobSetId };
      }),
    );
    for (const s of submissions) {
      if (s.status === "fulfilled") animationJobs.push(s.value);
      else {
        submissionsFailed++;
        log.warn({ err: s.reason }, "higgsfield submission failed; scene will use Ken Burns");
      }
    }
    log.info(
      {
        provider: motion.key,
        submitted: animationJobs.length,
        failed: submissionsFailed,
        scenes: imageAssetIds.length,
      },
      "motion jobs submitted",
    );
  }

  if (totalCost > 0n) {
    await recordCost({
      organizationId,
      category: "IMAGE_GENERATION",
      costMicroUsd: totalCost,
      moduleKey: "kids-shorts",
      workflowRunId,
      providerKey: "openai",
      description: `Media for "${title.slice(0, 60)}" (${scenes.length} images + voice-over)`,
    });
  }

  return {
    imageAssetIds,
    audioAssetId,
    audioKind,
    audioSeconds,
    animationJobs,
    motionProvider: motion?.key ?? null,
    submissionsFailed,
    assetIds,
    sceneCount: scenes.length,
    isReal: providers.real && imageAssetIds.length > 0,
    _costMicroUsd: totalCost.toString(),
  };
});

registerCodeFunction("assemble_zoo_video", async (args, context) => {
  const organizationId = String(args.organizationId ?? "");
  const workflowRunId = String(args.workflowRunId ?? "");
  const render = readPath(context, "$.steps.render") as {
    imageAssetIds?: string[];
    audioAssetId?: string;
    audioKind?: string;
    audioSeconds?: number;
    animationJobs?: { sceneIndex: number; jobSetId: string }[];
    sceneCount?: number;
    isReal?: boolean;
  };
  const metadata = readPath(context, "$.steps.metadata") as { title?: string };
  const title = metadata?.title ?? "Zoo short";
  const storage = getStorage();
  const providers = getMediaProviders();

  const imageAssetIds = render?.imageAssetIds ?? [];
  const animationJobs = render?.animationJobs ?? [];

  // Placeholder path (no real media generation configured).
  if (!render?.isReal || imageAssetIds.length === 0 || !render.audioAssetId) {
    const rendered = await providers.video.generateVideo({ prompt: title });
    const videoAssetId = await saveVideoAsset(organizationId, workflowRunId, title, rendered.data, {
      provider: providers.video.key,
      placeholder: true,
      sceneCount: render?.sceneCount ?? 0,
    });
    return { videoAssetId, isPlaceholder: true, animatedScenes: 0 };
  }

  // Load stills + voice back from storage.
  const loadAsset = async (id: string): Promise<Buffer> => {
    const asset = await prisma.asset.findUnique({ where: { id } });
    if (!asset) throw new Error(`Asset ${id} not found`);
    return storage.get(asset.storageKey);
  };
  const [imageBuffers, audioBuffer] = await Promise.all([
    Promise.all(imageAssetIds.map(loadAsset)),
    loadAsset(render.audioAssetId),
  ]);
  const audioSeconds =
    render.audioSeconds && render.audioSeconds > 1
      ? render.audioSeconds
      : await mp3DurationSeconds(audioBuffer, 600);

  // Musical cut timing (Animation 2.0): analyze the song's beat grid and
  // size scenes so every cut lands on a beat. Deterministic per run (the
  // audio is fixed), so the resumable scene cache stays valid across
  // attempts. "-v3" invalidates uniform-slot cache entries.
  const totalSeconds = audioSeconds + 1.2;
  const beatMap = analyzeBeats(audioBuffer);
  const sceneDurations = beatAlignedDurations(totalSeconds, imageAssetIds.length, beatMap);
  log.info(
    {
      bpm: beatMap.bpm,
      confidence: beatMap.confidence,
      durations: sceneDurations.map((d) => Number(d.toFixed(2))),
    },
    "beat-aligned scene durations",
  );

  // Probe the per-scene render cache (existence only — bytes are fetched
  // lazily at stitch time so probing costs nothing): scenes already rendered
  // by a previous attempt need neither their motion clip nor a re-encode,
  // so polling and downloads are skipped for them entirely.
  const sceneCachePrefix = `${organizationId}/${workflowRunId}/scene-render-v3-`;
  const cachedScenes = new Set<number>();
  for (let i = 0; i < imageAssetIds.length; i++) {
    if (await storage.exists(`${sceneCachePrefix}${i}.mp4`)) cachedScenes.add(i);
  }

  // Wait for motion clips — bounded so this invocation stays inside its
  // serverless limit. Scenes whose clip isn't ready fall back to Ken Burns.
  const motion = getMotionProvider();
  const clips = new Map<number, Buffer>();
  let clipCost = 0n;
  if (animationJobs.length > 0 && motion) {
    // 150s polling cap keeps poll + download + ffmpeg safely inside the
    // 300s invocation limit. Jobs were submitted before the DELAY step, so
    // this usually covers the provider's happy-path generation time.
    const deadline = Date.now() + 150_000;
    const jobsNeeded = animationJobs.filter((j) => !cachedScenes.has(j.sceneIndex));
    const results = await awaitMotionJobs(
      motion,
      jobsNeeded.map((j) => j.jobSetId),
      deadline,
    );
    const downloads = await Promise.allSettled(
      jobsNeeded.map(async (job) => {
        const r = results.get(job.jobSetId);
        if (r?.status !== "completed" || !r.videoUrl) {
          throw new Error(`clip not ready (${r?.status ?? "missing"})`);
        }
        return { sceneIndex: job.sceneIndex, data: await motion.download(r.videoUrl) };
      }),
    );
    for (const d of downloads) {
      if (d.status === "fulfilled") {
        clips.set(d.value.sceneIndex, d.value.data);
        clipCost += motion.clipCostMicroUsd;
      } else {
        log.warn({ err: d.reason }, "scene falls back to Ken Burns");
      }
    }
    log.info(
      { provider: motion.key, animated: clips.size, total: imageBuffers.length },
      "motion clips ready",
    );

    // Generation regularly outlasts one polling window: providers cap
    // per-account concurrency and their global queues back up. The jobs are
    // already paid for and still rendering server-side, so rather than
    // shipping a stills-only video, fail retryable while any job is
    // genuinely still pending — each retry is a fresh invocation with a
    // fresh polling budget. Terminal failures don't count as pending; the
    // final attempt ships whatever is ready.
    const stillPending = jobsNeeded.filter(
      (j) => (results.get(j.jobSetId)?.status ?? "pending") === "pending",
    ).length;
    if (stillPending > 0) {
      const attempt = await prisma.stepRun.count({
        where: { workflowRunId, stepKey: "assemble" },
      });
      // ~45 minutes of total patience: Higgsfield's global queue sometimes
      // backs up far beyond the happy-path 4 minutes.
      if (attempt <= 12) {
        throw new PlatformError(
          "PROVIDER_ERROR",
          `${clips.size}/${animationJobs.length} animation clips ready, ${stillPending} still rendering; retrying to collect the rest`,
          { retryable: true },
        );
      }
    }
  }

  // Songs are a complete soundtrack; the synth music-box bed is only for
  // the TTS-narration fallback.
  const withMusicBed = render.audioKind !== "song";
  // Per-scene renders are persisted to storage so an invocation that dies
  // mid-encode (serverless CPU is slow; the ceiling is real) resumes where
  // it left off instead of starting over.
  const videoData = await assembleNurseryVideo(imageBuffers, clips, audioBuffer, sceneDurations, {
    withMusicBed,
    clipSeconds: motion?.clipSeconds ?? 5.3,
    cached: cachedScenes,
    cacheGet: (i) => storage.get(`${sceneCachePrefix}${i}.mp4`),
    cachePut: async (i, data) => {
      await storage.put(`${sceneCachePrefix}${i}.mp4`, data, { contentType: "video/mp4" });
    },
  });
  // Best-effort cache cleanup — blobs are per-run and no longer needed.
  await Promise.allSettled(
    imageBuffers.map((_, i) => storage.delete(`${sceneCachePrefix}${i}.mp4`)),
  );
  const videoAssetId = await saveVideoAsset(organizationId, workflowRunId, title, videoData, {
    provider: clips.size > 0 ? `${motion?.key ?? "motion"}+ffmpeg` : "ffmpeg-kenburns-music",
    placeholder: false,
    audioKind: render.audioKind ?? "narration",
    sceneCount: imageBuffers.length,
    animatedScenes: clips.size,
    bpm: beatMap.bpm,
    durationSeconds: Math.round(audioSeconds),
  });

  if (clipCost > 0n) {
    await recordCost({
      organizationId,
      category: "VIDEO_GENERATION",
      costMicroUsd: clipCost,
      moduleKey: "kids-shorts",
      workflowRunId,
      providerKey: motion?.key ?? "motion",
      description: `Animated ${clips.size} scene(s) for "${title.slice(0, 60)}"`,
    });
  }

  return {
    videoAssetId,
    isPlaceholder: false,
    animatedScenes: clips.size,
    sceneCount: imageBuffers.length,
    _costMicroUsd: clipCost.toString(),
  };
});

async function saveVideoAsset(
  organizationId: string,
  workflowRunId: string,
  title: string,
  data: Buffer,
  meta: Record<string, unknown>,
): Promise<string> {
  const storage = getStorage();
  const key = `${organizationId}/${workflowRunId}/video-final-${Date.now()}`;
  const stored = await storage.put(key, data, { contentType: "video/mp4" });
  const asset = await prisma.asset.create({
    data: {
      organizationId,
      name: `Video: ${title.slice(0, 80)}`,
      type: "VIDEO",
      mimeType: "video/mp4",
      storageDriver: storage.driver,
      storageKey: stored.key,
      sizeBytes: stored.sizeBytes,
      moduleKey: "kids-shorts",
      workflowRunId,
      source: "workflow:zoo-shorts-pipeline:assemble",
      approvalStatus: "PENDING_REVIEW",
      metadata: meta as Prisma.InputJsonValue,
    },
  });
  return asset.id;
}

/**
 * Nursery-rhyme assembly. Animated scenes use their Higgsfield clip (scaled
 * and cropped to 1080x1920, gently time-stretched to the scene length);
 * others get a slow Ken Burns zoom. Each scene bakes a short dip-to-black
 * fade at its edges, so the final stitch is a stream-copy concat — no
 * re-encode, which keeps the last pass to seconds on slow serverless CPUs.
 * The sung voice-over sits on top of a soft synthesized music-box arpeggio
 * (generated in JS — no licensed audio involved).
 */
async function assembleNurseryVideo(
  images: Buffer[],
  clips: Map<number, Buffer>,
  audio: Buffer,
  sceneDurations: number[],
  opts: {
    withMusicBed: boolean;
    /** Nominal motion-clip length the provider produces (seconds). */
    clipSeconds: number;
    /** Scene indexes already rendered by a previous attempt (storage-backed). */
    cached: Set<number>;
    cacheGet: (i: number) => Promise<Buffer>;
    cachePut: (i: number, data: Buffer) => Promise<void>;
  },
): Promise<Buffer> {
  const { withMusicBed } = opts;
  const ffmpegPath = resolveFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), "zoo-"));
  try {
    const n = images.length;
    const total = sceneDurations.reduce((a, b) => a + b, 0);
    const fps = 24;

    const audioFile = path.join(dir, "voice.mp3");
    writeFileSync(audioFile, audio);
    const outFile = path.join(dir, "out.mp4");

    // Pass 1 — render each scene to its own normalized file, one ffmpeg
    // process at a time (sequential keeps peak memory to one small
    // pipeline; a mega filter graph OOMs the invocation). Scene lengths
    // come from the beat map so every cut lands on a beat.
    const t0 = Date.now();
    const elapsed = (): string => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
    const sceneFile = (i: number): string => path.join(dir, `scene${i}.mp4`);
    const order = [...Array(n).keys()];
    for (const i of order.filter((x) => !opts.cached.has(x))) {
      const sceneOut = sceneFile(i);
      const sceneLen = sceneDurations[i] as number;
      // Soft dip between scenes, baked in so the stitch never re-encodes.
      const edgeFade = `,fade=t=in:d=0.25,fade=t=out:st=${Math.max(0, sceneLen - 0.25).toFixed(2)}:d=0.25`;
      let input: string;
      let filter: string;
      const clip = clips.get(i);
      if (clip) {
        input = path.join(dir, `clip${i}.mp4`);
        writeFileSync(input, clip);
        // Gentle time-stretch caps at 1.35x — anything slower reads as
        // floaty slow-motion (the old 2.2x cap was a major "AI feel"
        // culprit). Clone-pad covers any remainder; fps must come last
        // (tpad/trim drop the rate metadata concat relies on).
        const stretch = Math.min(1.35, Math.max(0.75, sceneLen / opts.clipSeconds));
        filter =
          `setpts=${stretch.toFixed(4)}*PTS,` +
          `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
          `tpad=stop_mode=clone:stop_duration=10,trim=duration=${sceneLen.toFixed(2)},` +
          `setpts=PTS-STARTPTS,fps=${fps}${edgeFade}`;
      } else {
        input = path.join(dir, `img${i}.png`);
        writeFileSync(input, images[i] as Buffer);
        // Ken Burns per still: gentle zoom-in, alternating with zoom-out.
        const frames = Math.ceil(sceneLen * fps);
        const zoomExpr =
          i % 2 === 0
            ? `min(1+0.0018*on,1.14)` // zoom in
            : `max(1.14-0.0018*on,1.0)`; // zoom out
        filter =
          `scale=1400:2489:force_original_aspect_ratio=increase,crop=1400:2489,` +
          `zoompan=z='${zoomExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${fps}${edgeFade}`;
      }
      execFileSync(
        ffmpegPath,
        [
          "-y",
          "-i",
          input,
          "-vf",
          filter,
          "-t",
          sceneLen.toFixed(2),
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          sceneOut,
        ],
        { stdio: ["ignore", "ignore", "pipe"], timeout: 90_000 },
      );
      await opts.cachePut(i, readFileSync(sceneOut));
      log.info({ scene: i, cached: false, at: elapsed() }, "scene rendered");
    }
    // All scenes rendered — now pull the previously-cached ones.
    for (const i of order.filter((x) => opts.cached.has(x))) {
      writeFileSync(sceneFile(i), await opts.cacheGet(i));
      log.info({ scene: i, cached: true, at: elapsed() }, "scene ready");
    }
    log.info({ at: elapsed(), scenes: n }, "pass1 complete; starting stitch");

    // Pass 2 — concat with STREAM COPY (scene files are uniform h264, each
    // starting on a keyframe): video is never re-encoded, so this pass takes
    // seconds regardless of length. Only the audio graph is computed.
    const listFile = path.join(dir, "concat.txt");
    writeFileSync(listFile, order.map((i) => `file '${sceneFile(i)}'`).join("\n"));

    // Audio graph. Narration mode layers the JS-synthesized music-box bed
    // under the voice; song mode uses the sung track as-is (it already has
    // full instrumentation) with a gentle fade-out at the end.
    const audioInputs: string[] = [];
    const filters: string[] = [];
    if (withMusicBed) {
      const musicFile = path.join(dir, "music.wav");
      writeFileSync(musicFile, synthMusicBoxWav(total));
      audioInputs.push("-i", musicFile);
      filters.push(`[1:a]volume=1.0[voice]`);
      filters.push(
        `[2:a]volume=0.16,afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[music]`,
      );
      filters.push(`[voice][music]amix=inputs=2:duration=first:normalize=0[aout]`);
    } else {
      filters.push(`[1:a]afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2[aout]`);
    }

    execFileSync(
      ffmpegPath,
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-i",
        audioFile,
        ...audioInputs,
        "-filter_complex",
        filters.join(";"),
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-t",
        total.toFixed(2),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outFile,
      ],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 120_000 },
    );
    log.info({ at: elapsed() }, "stitch complete");
    return readFileSync(outFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Tiny music-box synthesizer: C-major pentatonic arpeggio, decaying sine
 * plucks with a soft octave partial, 16-bit mono WAV. Entirely generated —
 * no licensing concerns.
 */
function synthMusicBoxWav(seconds: number): Buffer {
  const rate = 44100;
  const noteLen = 0.4;
  const notes = [523.25, 659.25, 783.99, 880.0, 1046.5, 880.0, 783.99, 659.25];
  const totalSamples = Math.ceil(seconds * rate);
  const pcm = new Int16Array(totalSamples);
  for (let s2 = 0; s2 < totalSamples; s2++) {
    const t = s2 / rate;
    const noteIndex = Math.floor(t / noteLen) % notes.length;
    const tin = t % noteLen;
    const freq = notes[noteIndex] ?? 523.25;
    const env = Math.exp(-5 * tin);
    const sample =
      (Math.sin(2 * Math.PI * freq * tin) * 0.7 + Math.sin(2 * Math.PI * freq * 2 * tin) * 0.2) *
      env *
      0.5;
    pcm[s2] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
  }
  return pcmToWav(pcm, rate);
}
