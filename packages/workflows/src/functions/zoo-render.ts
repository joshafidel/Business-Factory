import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordCost } from "@bf/agents";
import { loadEnv } from "@bf/config";
import { prisma, type Prisma } from "@bf/database";
import {
  awaitJobSets,
  downloadClip,
  getMediaProviders,
  higgsfieldConfigured,
  submitImageToVideo,
  HIGGSFIELD_CLIP_COST_MICRO_USD,
} from "@bf/providers";
import { getStorage } from "@bf/storage";
import { castLooks, createLogger, PlatformError, signAssetToken } from "@bf/shared";
import { registerCodeFunction, readPath } from "../definitions";
import { mp3DurationSeconds, pcmToWav, resolveFfmpeg } from "./media-utils";

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

/** Nominal Higgsfield clip length (dop-lite produces ~5.3-5.4s). */
const HF_CLIP_SECONDS = 5.3;

/** Public URL Higgsfield's fetcher can use to download scene images. */
function publicBaseUrl(): string | undefined {
  const env = loadEnv();
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return undefined;
}

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

  // Scene images — parallel; serverless wall-clock matters. Injecting each
  // character's verbatim look-line keeps the recurring cast visually
  // consistent across scenes and episodes (the heart of a kids' "show").
  const style =
    "Soft rounded shapes, pastel rainbow colors, glossy 3D toddler-animation style like modern " +
    "nursery rhyme cartoons, huge sparkly eyes, soft cinematic lighting, cheerful sunny zoo " +
    "playground background, no text, no words, no letters";
  const images = await Promise.all(
    scenes.map((scene, i) => {
      const looks = castLooks(scene?.characters ?? []);
      const castLine =
        looks.length > 0 ? ` Characters (keep these exact designs): ${looks.join("; ")}.` : "";
      return providers.image
        .generateImage({ prompt: `${scene?.visual ?? "happy zoo animal"}.${castLine} ${style}` })
        .then((r) => ({ i, r }));
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
  if (providers.real && higgsfieldConfigured() && base && imageAssetIds.length > 0) {
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
        const motion = (scenes[i]?.visual ?? "a happy baby zoo animal").slice(0, 300);
        const jobSetId = await submitImageToVideo({
          imageUrl,
          prompt:
            `Gentle toddler-cartoon animation: ${motion}. The cute baby animals move softly and ` +
            "expressively — they blink, bounce to the music, wiggle ears, smile at each other. " +
            "Slow smooth cinematic camera, subtle motion, keep the exact 3D nursery-rhyme art " +
            "style of the image. No text.",
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
      { submitted: animationJobs.length, failed: submissionsFailed, scenes: imageAssetIds.length },
      "higgsfield jobs submitted",
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

  // Wait for Higgsfield clips — bounded so this invocation stays inside its
  // serverless limit. Scenes whose clip isn't ready fall back to Ken Burns.
  const clips = new Map<number, Buffer>();
  let clipCost = 0n;
  if (animationJobs.length > 0) {
    // 150s polling cap keeps poll + download + ffmpeg safely inside the
    // 300s invocation limit (attempt 1 previously timed out at 205s). Jobs
    // were submitted ~65s ago (render end + the 60s DELAY step), so this
    // still covers dop-lite's observed 180-216s generation time.
    const deadline = Date.now() + 150_000;
    const results = await awaitJobSets(
      animationJobs.map((j) => j.jobSetId),
      deadline,
    );
    const downloads = await Promise.allSettled(
      animationJobs.map(async (job) => {
        const r = results.get(job.jobSetId);
        if (r?.status !== "completed" || !r.videoUrl) {
          throw new Error(`clip not ready (${r?.status ?? "missing"})`);
        }
        return { sceneIndex: job.sceneIndex, data: await downloadClip(r.videoUrl) };
      }),
    );
    for (const d of downloads) {
      if (d.status === "fulfilled") {
        clips.set(d.value.sceneIndex, d.value.data);
        clipCost += HIGGSFIELD_CLIP_COST_MICRO_USD;
      } else {
        log.warn({ err: d.reason }, "scene falls back to Ken Burns");
      }
    }
    log.info({ animated: clips.size, total: imageBuffers.length }, "higgsfield clips ready");

    // Generation regularly outlasts one polling window: Higgsfield caps
    // per-account concurrency, so 8 jobs serialize into batches (~3.5min
    // each). The jobs are already paid for and still rendering server-side,
    // so rather than shipping a stills-only video, fail retryable while any
    // job is genuinely still pending — each retry is a fresh invocation with
    // a fresh polling budget. Jobs that terminally failed (nsfw/canceled)
    // don't count as pending; the final attempt ships whatever is ready.
    const stillPending = animationJobs.filter(
      (j) => (results.get(j.jobSetId)?.status ?? "unknown") === "unknown",
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
  const sceneCachePrefix = `${organizationId}/${workflowRunId}/scene-render-`;
  const videoData = await assembleNurseryVideo(imageBuffers, clips, audioBuffer, audioSeconds, {
    withMusicBed,
    cacheGet: async (i) => {
      const key = `${sceneCachePrefix}${i}.mp4`;
      return (await storage.exists(key)) ? storage.get(key) : null;
    },
    cachePut: async (i, data) => {
      await storage.put(`${sceneCachePrefix}${i}.mp4`, data, { contentType: "video/mp4" });
    },
  });
  // Best-effort cache cleanup — blobs are per-run and no longer needed.
  await Promise.allSettled(
    imageBuffers.map((_, i) => storage.delete(`${sceneCachePrefix}${i}.mp4`)),
  );
  const videoAssetId = await saveVideoAsset(organizationId, workflowRunId, title, videoData, {
    provider: clips.size > 0 ? "higgsfield+ffmpeg" : "ffmpeg-kenburns-music",
    placeholder: false,
    audioKind: render.audioKind ?? "narration",
    sceneCount: imageBuffers.length,
    animatedScenes: clips.size,
    durationSeconds: Math.round(audioSeconds),
  });

  if (clipCost > 0n) {
    await recordCost({
      organizationId,
      category: "VIDEO_GENERATION",
      costMicroUsd: clipCost,
      moduleKey: "kids-shorts",
      workflowRunId,
      providerKey: "higgsfield",
      description: `Animated ${clips.size} scene(s) for "${title.slice(0, 60)}" (dop-lite)`,
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
 * others get a slow Ken Burns zoom. 0.6s crossfades chain the scenes, the
 * sung voice-over sits on top of a soft synthesized music-box arpeggio
 * (generated in JS — no licensed audio involved).
 */
async function assembleNurseryVideo(
  images: Buffer[],
  clips: Map<number, Buffer>,
  audio: Buffer,
  audioSeconds: number,
  opts: {
    withMusicBed: boolean;
    /** Resumable per-scene render cache (storage-backed). */
    cacheGet: (i: number) => Promise<Buffer | null>;
    cachePut: (i: number, data: Buffer) => Promise<void>;
  },
): Promise<Buffer> {
  const { withMusicBed } = opts;
  const ffmpegPath = resolveFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), "zoo-"));
  try {
    const n = images.length;
    const fade = 0.6;
    const total = audioSeconds + 1.2;
    // Every scene has the same length; crossfades overlap them.
    const clipLen = (total + (n - 1) * fade) / n;
    const fps = 24;
    const frames = Math.ceil(clipLen * fps);

    const audioFile = path.join(dir, "voice.mp3");
    writeFileSync(audioFile, audio);
    const outFile = path.join(dir, "out.mp4");

    // Pass 1 — render each scene to its own normalized file, one ffmpeg
    // process at a time. A single graph with several video decoders plus
    // zoompan upscales peaks past the serverless memory limit and kills the
    // invocation mid-encode; sequential per-scene renders keep peak memory
    // to a single small pipeline.
    const sceneFiles: string[] = [];
    for (let i = 0; i < n; i++) {
      const sceneOut = path.join(dir, `scene${i}.mp4`);
      const cached = await opts.cacheGet(i);
      if (cached) {
        writeFileSync(sceneOut, cached);
        sceneFiles.push(sceneOut);
        continue;
      }
      let input: string;
      let filter: string;
      const clip = clips.get(i);
      if (clip) {
        input = path.join(dir, `clip${i}.mp4`);
        writeFileSync(input, clip);
        // Gentle time-stretch so the ~5.3s clip fills the scene slot, then
        // clone-pad as a safety net and trim to the exact length. fps must
        // come last: xfade requires CFR inputs and tpad/trim drop the rate.
        // Cap 2.2x: a dreamy half-speed motion still reads better for
        // toddlers than a frozen frame.
        const stretch = Math.min(2.2, Math.max(0.75, clipLen / HF_CLIP_SECONDS));
        filter =
          `setpts=${stretch.toFixed(4)}*PTS,` +
          `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
          `tpad=stop_mode=clone:stop_duration=10,trim=duration=${clipLen.toFixed(2)},` +
          `setpts=PTS-STARTPTS,fps=${fps}`;
      } else {
        input = path.join(dir, `img${i}.png`);
        writeFileSync(input, images[i] as Buffer);
        // Ken Burns per still: gentle zoom-in, alternating with zoom-out.
        const zoomExpr =
          i % 2 === 0
            ? `min(1+0.0018*on,1.14)` // zoom in
            : `max(1.14-0.0018*on,1.0)`; // zoom out
        filter =
          `scale=1400:2489:force_original_aspect_ratio=increase,crop=1400:2489,` +
          `zoompan=z='${zoomExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${fps}`;
      }
      execFileSync(
        ffmpegPath,
        [
          "-y", "-i", input, "-vf", filter,
          "-t", clipLen.toFixed(2), "-an",
          "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
          sceneOut,
        ],
        { stdio: ["ignore", "ignore", "pipe"], timeout: 90_000 },
      );
      await opts.cachePut(i, readFileSync(sceneOut));
      sceneFiles.push(sceneOut);
    }

    // Pass 2 — stitch the uniform scene files with crossfades and mix audio.
    // Plain decoders only; light on memory.
    const inputs: string[] = [];
    for (const f of sceneFiles) inputs.push("-i", f);
    const filters: string[] = [];
    let last = "0:v";
    for (let i = 1; i < n; i++) {
      const out = i === n - 1 ? "vout" : `x${i}`;
      const offset = (i * (clipLen - fade)).toFixed(2);
      filters.push(
        `[${last}][${i}:v]xfade=transition=fade:duration=${fade}:offset=${offset}[${out}]`,
      );
      last = out;
    }
    if (n === 1) filters.push(`[0:v]copy[vout]`);

    // Audio graph. Narration mode layers the JS-synthesized music-box bed
    // under the voice; song mode uses the sung track as-is (it already has
    // full instrumentation) with a gentle fade-out at the end.
    const audioInputs: string[] = [];
    if (withMusicBed) {
      const musicFile = path.join(dir, "music.wav");
      writeFileSync(musicFile, synthMusicBoxWav(total));
      audioInputs.push("-i", musicFile);
      filters.push(`[${n}:a]volume=1.0[voice]`);
      filters.push(
        `[${n + 1}:a]volume=0.16,afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[music]`,
      );
      filters.push(`[voice][music]amix=inputs=2:duration=first:normalize=0[aout]`);
    } else {
      filters.push(`[${n}:a]afade=t=out:st=${Math.max(0, total - 1.2).toFixed(2)}:d=1.2[aout]`);
    }

    execFileSync(
      ffmpegPath,
      [
        "-y",
        ...inputs,
        "-i",
        audioFile,
        ...audioInputs,
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[vout]",
        "-map",
        "[aout]",
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-pix_fmt",
        "yuv420p",
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
      { stdio: ["ignore", "ignore", "pipe"], timeout: 240_000 },
    );
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
