import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordCost } from "@bf/agents";
import { loadEnv } from "@bf/config";
import { prisma, type Prisma } from "@bf/database";
import {
  awaitJobSets,
  CONSERVATIVE_MOTION_GUARDRAILS,
  downloadClip,
  getImageMotionProvider,
  getMediaProviders,
  higgsfieldConfigured,
  HIGGSFIELD_CLIP_COST_MICRO_USD,
  picsartConfigured,
  submitImageToVideo,
  type ImageMotionProvider,
} from "@bf/providers";
import { getStorage } from "@bf/storage";
import { createLogger, PlatformError, signAssetToken } from "@bf/shared";
import { registerCodeFunction, readPath } from "../definitions";
import {
  mp3DurationSeconds,
  pcmToWav,
  publicBaseUrl,
  resolveFfmpeg,
} from "../functions/media-utils";
import { buildSrt, computeSceneTimings, type SceneTiming } from "./captions";
import { getTemplate, type MotionPreset, type VideoTemplate } from "./templates";
import {
  LIMITS,
  MODULE_KEY,
  VIDEO_FORMATS,
  renderSettingsSchema,
  type RenderSettings,
} from "./types";

const log = createLogger("lvf-render");

/**
 * The Listing Video Factory render pipeline, as two workflow code functions
 * so each gets its own invocation budget (background job in queue mode, its
 * own serverless invocation in inline mode):
 *
 *  1. listing_factory_prepare — per-scene voice-over via the TTS provider,
 *     with hash-based reuse so an unchanged line is never paid for twice.
 *  2. listing_factory_assemble — deterministic motion render: Ken Burns /
 *     pan presets per photo, template-driven crossfades, client-rasterized
 *     text overlays, synthesized royalty-free music bed with real
 *     voice-ducking, then the output package (SRT + generation report).
 *
 * All typography arrives as full-frame transparent PNGs rasterized by the
 * browser at render time — this ffmpeg build has no drawtext, and client
 * rasterization gives pixel-perfect brand typography anyway.
 */

const OUTRO_CARD_SECONDS = 3.6;
/** Nominal Higgsfield clip length (dop-lite produces ~5.3-5.4s). */
const HF_CLIP_SECONDS = 5.3;

interface AnimationJob {
  sceneIndex: number;
  jobSetId: string;
  /** Which image-to-video backend produced the job. */
  provider: "higgsfield" | "picsart";
}

/** Camera brief per shot, always wrapped in the conservative guardrails. */
function motionPrompt(roomLabel: string | null, category: string): string {
  const subject =
    category === "exterior" || category === "aerial"
      ? `a slow, smooth cinematic push toward the home's ${roomLabel === "Backyard" ? "backyard" : "entrance"}`
      : `a smooth steadicam glide forward through the ${roomLabel?.toLowerCase() ?? "room"}`;
  return (
    `Real-estate walkthrough shot: ${subject}, as if a videographer is walking through with a ` +
    `gimbal. Gentle, constant speed. ${CONSERVATIVE_MOTION_GUARDRAILS}`
  );
}

interface VoiceSegment {
  /** Scene index the clip belongs to; the outro card uses the last index+1. */
  sceneIndex: number;
  assetId: string;
  seconds: number;
  chars: number;
}

/** Poll Picsart inferences until done or deadline (mirrors awaitJobSets). */
async function awaitPicsartJobs(
  jobIds: string[],
  deadlineMs: number,
  pollIntervalMs = 10_000,
): Promise<Map<string, { status: string; videoUrl?: string }>> {
  const provider: ImageMotionProvider | null = getImageMotionProvider();
  const results = new Map<string, { status: string; videoUrl?: string }>();
  if (!provider) {
    for (const id of jobIds) results.set(id, { status: "unknown" });
    return results;
  }
  const pending = new Set(jobIds);
  while (pending.size > 0 && Date.now() < deadlineMs) {
    const polled = await Promise.all(
      [...pending].map(async (id) => ({ id, r: await provider.checkGenerationStatus(id) })),
    );
    for (const { id, r } of polled) {
      if (r.status === "completed") {
        results.set(id, { status: "completed", videoUrl: r.videoUrl });
        pending.delete(id);
      } else if (r.status === "failed") {
        results.set(id, { status: "failed" });
        pending.delete(id);
        log.warn({ id, error: r.error }, "picsart job failed");
      }
    }
    if (pending.size > 0) {
      await new Promise((r) =>
        setTimeout(r, Math.min(pollIntervalMs, Math.max(0, deadlineMs - Date.now()))),
      );
    }
  }
  for (const id of pending) results.set(id, { status: "unknown" });
  return results;
}

async function loadRender(renderId: string): Promise<{
  render: { id: string; organizationId: string; projectId: string; kind: string };
  settings: RenderSettings;
}> {
  const render = await prisma.listingRender.findUnique({ where: { id: renderId } });
  if (!render) throw new PlatformError("NOT_FOUND", `ListingRender ${renderId} not found`);
  const settings = renderSettingsSchema.parse(render.settings);
  return { render, settings };
}

registerCodeFunction("listing_factory_prepare", async (_args, context) => {
  const renderId = String(readPath(context, "$.input.renderId") ?? "");
  const { render, settings } = await loadRender(renderId);
  const organizationId = render.organizationId;
  await prisma.listingRender.update({
    where: { id: render.id },
    data: { status: "RUNNING", error: null },
  });

  const template = getTemplate(settings.style);
  const wantVoice = settings.options.voiceover && template.voiceover;
  const animationJobs = await submitAnimationJobs(render, settings);
  if (!wantVoice) {
    return {
      renderId,
      segments: [],
      voiceReal: false,
      animationJobs,
      hasAnimation: animationJobs.length > 0,
      _costMicroUsd: "0",
    };
  }

  const providers = getMediaProviders();
  const storage = getStorage();
  const script = settings.script;
  const sceneCount = settings.photoIds.length;

  // Spoken lines per scene: the hook leads scene 0; outro + CTA land on the
  // agent end card (or the last scene when the outro card is disabled).
  const texts: { sceneIndex: number; text: string }[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const scene = script.scenes[i];
    const parts = [i === 0 ? script.hook : "", scene?.narration ?? ""];
    const text = parts.filter(Boolean).join(" ").trim();
    if (text) texts.push({ sceneIndex: i, text });
  }
  const closing = [script.outro, script.cta].filter(Boolean).join(" ").trim();
  if (closing) {
    texts.push({ sceneIndex: settings.options.agentOutro ? sceneCount : sceneCount - 1, text: closing });
  }

  const segments: VoiceSegment[] = [];
  let newCost = 0n;
  for (const { sceneIndex, text } of texts) {
    const hash = createHash("sha256")
      .update(`${providers.audio.key}|${template.voiceStyle}|${text}`)
      .digest("hex");
    const reusable = await prisma.asset.findFirst({
      where: {
        organizationId,
        type: "AUDIO",
        moduleKey: MODULE_KEY,
        metadata: { path: ["narrationHash"], equals: hash },
      },
      orderBy: { createdAt: "desc" },
    });
    if (reusable) {
      const meta = reusable.metadata as { seconds?: number } | null;
      segments.push({
        sceneIndex,
        assetId: reusable.id,
        seconds: meta?.seconds ?? (await mp3DurationSeconds(await storage.get(reusable.storageKey), text.length)),
        chars: text.length,
      });
      continue;
    }
    const voice = await providers.audio.generateSpeech({ text, style: template.voiceStyle });
    const seconds = await mp3DurationSeconds(voice.data, text.length);
    const key = `${organizationId}/${render.projectId}/voice-${hash.slice(0, 16)}`;
    const stored = await storage.put(key, voice.data, { contentType: voice.mimeType });
    const asset = await prisma.asset.create({
      data: {
        organizationId,
        name: `Narration line (scene ${sceneIndex + 1})`,
        type: "AUDIO",
        mimeType: voice.mimeType,
        storageDriver: storage.driver,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        moduleKey: MODULE_KEY,
        source: "workflow:listing-factory-render:prepare",
        approvalStatus: "PENDING_REVIEW",
        metadata: {
          narrationHash: hash,
          seconds,
          provider: providers.audio.key,
          projectId: render.projectId,
        } as Prisma.InputJsonValue,
      },
    });
    newCost += voice.costMicroUsd;
    segments.push({ sceneIndex, assetId: asset.id, seconds, chars: text.length });
  }

  if (newCost > 0n) {
    await recordCost({
      organizationId,
      category: "AUDIO_GENERATION",
      costMicroUsd: newCost,
      moduleKey: MODULE_KEY,
      workflowRunId: String(readPath(context, "$.runId") ?? "") || undefined,
      providerKey: providers.audio.key.startsWith("elevenlabs") ? "elevenlabs" : "openai",
      description: `Voice-over for render ${render.id} (${segments.length} lines)`,
    });
    await prisma.listingRender.update({
      where: { id: render.id },
      data: { costMicroUsd: { increment: newCost } },
    });
  }

  return {
    renderId,
    segments,
    voiceReal: providers.real,
    animationJobs,
    hasAnimation: animationJobs.length > 0,
    _costMicroUsd: newCost.toString(),
  };
});

/**
 * AI walkthrough motion: submit one conservative image-to-video job per
 * photo (final renders with the option on, provider configured, and a
 * public base URL for the image fetcher). Failures degrade per scene to
 * deterministic Ken Burns — never fail the render here.
 */
async function submitAnimationJobs(
  render: { id: string; organizationId: string; projectId: string },
  settings: RenderSettings,
): Promise<AnimationJob[]> {
  const base = publicBaseUrl();
  const useHiggsfield = higgsfieldConfigured();
  const picsart = !useHiggsfield && picsartConfigured() ? getImageMotionProvider() : null;
  if (
    settings.kind !== "final" ||
    !settings.options.aiMotion ||
    (!useHiggsfield && !picsart) ||
    !base
  ) {
    return [];
  }
  const photos = await prisma.listingPhoto.findMany({
    where: { id: { in: settings.photoIds }, organizationId: render.organizationId },
    select: { id: true, assetId: true, roomLabel: true, category: true },
  });
  const byId = new Map(photos.map((p) => [p.id, p]));
  const env = loadEnv();
  const exp = Math.floor(Date.now() / 1000) + 2 * 60 * 60;
  const targets = settings.photoIds
    .slice(0, LIMITS.maxAiMotionScenes)
    .map((photoId, sceneIndex) => ({ photo: byId.get(photoId), sceneIndex }))
    .filter((t): t is { photo: NonNullable<typeof t.photo>; sceneIndex: number } =>
      Boolean(t.photo),
    );
  const submissions = await Promise.allSettled(
    targets.map(async ({ photo, sceneIndex }): Promise<AnimationJob> => {
      const sig = signAssetToken(env.SECRET_ENCRYPTION_KEY, photo.assetId, exp);
      const imageUrl = `${base}/api/assets/public?id=${photo.assetId}&exp=${exp}&sig=${sig}`;
      const prompt = motionPrompt(photo.roomLabel, photo.category);
      if (useHiggsfield) {
        const jobSetId = await submitImageToVideo({ imageUrl, prompt });
        return { sceneIndex, jobSetId, provider: "higgsfield" };
      }
      const { jobId } = await picsart!.generateMotion({ imageUrl, prompt, durationSeconds: 5 });
      return { sceneIndex, jobSetId: jobId, provider: "picsart" };
    }),
  );
  const jobs: AnimationJob[] = [];
  for (const s of submissions) {
    if (s.status === "fulfilled") jobs.push(s.value);
    else log.warn({ err: s.reason }, "higgsfield submission failed; scene will use Ken Burns");
  }
  log.info({ submitted: jobs.length, scenes: settings.photoIds.length }, "walkthrough jobs submitted");
  return jobs;
}

registerCodeFunction("listing_factory_assemble", async (args, context) => {
  const workflowRunId = String(args.workflowRunId ?? "");
  const renderId = String(readPath(context, "$.input.renderId") ?? "");
  const { render, settings } = await loadRender(renderId);
  const organizationId = render.organizationId;
  const prepare = readPath(context, "$.steps.prepare") as {
    segments?: VoiceSegment[];
    voiceReal?: boolean;
    animationJobs?: AnimationJob[];
  };
  const segments = prepare?.segments ?? [];
  const animationJobs = prepare?.animationJobs ?? [];
  const storage = getStorage();
  const template = getTemplate(settings.style);
  const isPreview = settings.kind === "preview";

  try {
    // ── Load photo bytes in render order ─────────────────────────────────
    const photos = await prisma.listingPhoto.findMany({
      where: { id: { in: settings.photoIds }, organizationId },
      include: { asset: true },
    });
    const photoById = new Map(photos.map((p) => [p.id, p]));
    const orderedPhotos = settings.photoIds
      .map((id) => photoById.get(id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));
    if (orderedPhotos.length === 0) {
      throw new PlatformError("STEP_FAILED", "No photos available for this render");
    }
    const photoBuffers = await Promise.all(orderedPhotos.map((p) => storage.get(p.asset.storageKey)));

    // ── Overlays (client-rasterized PNGs) ────────────────────────────────
    const overlayAssets = new Map<string, Buffer>();
    for (const ov of settings.overlays) {
      const asset = await prisma.asset.findFirst({
        where: { id: ov.assetId, organizationId },
      });
      if (asset) overlayAssets.set(ov.assetId, await storage.get(asset.storageKey));
      else log.warn({ overlay: ov }, "overlay asset missing; skipping");
    }

    // ── Timing model ─────────────────────────────────────────────────────
    const useOutroCard =
      settings.options.agentOutro &&
      settings.overlays.some((o) => o.role === "outro" && overlayAssets.has(o.assetId));
    const narrationSeconds: number[] = orderedPhotos.map((_, i) => {
      const seg = segments.find((s) => s.sceneIndex === i);
      return seg?.seconds ?? 0;
    });
    const { timings, totalSeconds } = computeSceneTimings({
      sceneCount: orderedPhotos.length,
      template,
      targetSeconds: settings.options.targetSeconds,
      narrationSeconds,
      outroSeconds: useOutroCard ? OUTRO_CARD_SECONDS : 0,
    });

    // ── Audio segment bytes ──────────────────────────────────────────────
    const segmentBuffers: { sceneIndex: number; data: Buffer }[] = [];
    for (const seg of segments) {
      const asset = await prisma.asset.findFirst({ where: { id: seg.assetId, organizationId } });
      if (asset) segmentBuffers.push({ sceneIndex: seg.sceneIndex, data: await storage.get(asset.storageKey) });
    }

    // ── AI walkthrough clips: bounded polling; missing scenes fall back to
    // Ken Burns. Generation can outlast one attempt's window — the jobs are
    // already paid for and still rendering server-side, so fail retryable
    // and let a fresh invocation collect them (final attempt ships whatever
    // is ready).
    const clips = new Map<number, Buffer>();
    let clipCost = 0n;
    if (animationJobs.length > 0) {
      const deadline = Date.now() + 150_000;
      const hfJobs = animationJobs.filter((j) => j.provider === "higgsfield");
      const psJobs = animationJobs.filter((j) => j.provider === "picsart");
      const [hfResults, psResults] = await Promise.all([
        hfJobs.length > 0
          ? awaitJobSets(
              hfJobs.map((j) => j.jobSetId),
              deadline,
            )
          : new Map<string, { status: string; videoUrl?: string }>(),
        psJobs.length > 0
          ? awaitPicsartJobs(
              psJobs.map((j) => j.jobSetId),
              deadline,
            )
          : new Map<string, { status: string; videoUrl?: string }>(),
      ]);
      const picsartProvider = psJobs.length > 0 ? getImageMotionProvider() : null;
      const downloads = await Promise.allSettled(
        animationJobs.map(async (job) => {
          const r =
            job.provider === "higgsfield" ? hfResults.get(job.jobSetId) : psResults.get(job.jobSetId);
          if (r?.status !== "completed" || !r.videoUrl) {
            throw new Error(`clip not ready (${r?.status ?? "missing"})`);
          }
          const data =
            job.provider === "higgsfield"
              ? await downloadClip(r.videoUrl)
              : await picsartProvider!.downloadGeneration(r.videoUrl);
          return { sceneIndex: job.sceneIndex, data, provider: job.provider };
        }),
      );
      for (const d of downloads) {
        if (d.status === "fulfilled") {
          clips.set(d.value.sceneIndex, d.value.data);
          clipCost += HIGGSFIELD_CLIP_COST_MICRO_USD; // both providers ≈ $0.55/clip
        } else {
          log.warn({ err: d.reason }, "scene falls back to Ken Burns");
        }
      }
      log.info({ animated: clips.size, total: animationJobs.length }, "walkthrough clips ready");
      if (clips.size < animationJobs.length) {
        const attempt = await prisma.stepRun.count({
          where: { workflowRunId, stepKey: "assemble" },
        });
        if (attempt <= 2) {
          throw new PlatformError(
            "PROVIDER_ERROR",
            `Only ${clips.size}/${animationJobs.length} walkthrough clips ready; retrying to collect the rest`,
            { retryable: true },
          );
        }
      }
      if (clipCost > 0n) {
        await recordCost({
          organizationId,
          category: "VIDEO_GENERATION",
          costMicroUsd: clipCost,
          moduleKey: MODULE_KEY,
          providerKey: "higgsfield",
          description: `AI walkthrough motion: ${clips.size} scene(s) for render ${render.id}`,
        });
        await prisma.listingRender.update({
          where: { id: render.id },
          data: { costMicroUsd: { increment: clipCost } },
        });
      }
    }

    const videoData = assembleVideo({
      settings,
      template,
      isPreview,
      photoBuffers,
      clips,
      overlays: settings.overlays
        .filter((o) => overlayAssets.has(o.assetId))
        .map((o) => ({ ...o, data: overlayAssets.get(o.assetId)! })),
      segments: segmentBuffers,
      timings,
      totalSeconds,
      useOutroCard,
      musicOn: settings.options.music,
    });

    // ── Persist the video ────────────────────────────────────────────────
    const project = await prisma.listingProject.findUnique({ where: { id: render.projectId } });
    const title = `${isPreview ? "Preview" : "Video"}: ${project?.name ?? "Listing"}`;
    const stored = await storage.put(
      `${organizationId}/${render.projectId}/render-${render.id}${isPreview ? "-preview" : ""}.mp4`,
      videoData,
      { contentType: "video/mp4" },
    );
    const videoAsset = await prisma.asset.create({
      data: {
        organizationId,
        name: title,
        type: "VIDEO",
        mimeType: "video/mp4",
        storageDriver: storage.driver,
        storageKey: stored.key,
        sizeBytes: stored.sizeBytes,
        moduleKey: MODULE_KEY,
        source: "workflow:listing-factory-render:assemble",
        approvalStatus: "PENDING_REVIEW",
        metadata: {
          renderId: render.id,
          projectId: render.projectId,
          kind: settings.kind,
          format: settings.format,
          style: settings.style,
          durationSeconds: Math.round(totalSeconds),
          sceneCount: orderedPhotos.length,
          animatedScenes: clips.size,
          provider: clips.size > 0 ? "higgsfield+ffmpeg" : "ffmpeg-kenburns-ambient",
          voiceReal: prepare?.voiceReal ?? false,
        } as Prisma.InputJsonValue,
      },
    });

    // ── Output package: narration SRT + generation report ───────────────
    const srtEntries = segments
      .map((seg) => {
        const t: SceneTiming | undefined = timings[seg.sceneIndex];
        if (!t) return null;
        const scene = settings.script.scenes[seg.sceneIndex];
        const text =
          seg.sceneIndex === 0
            ? [settings.script.hook, scene?.narration].filter(Boolean).join(" ")
            : seg.sceneIndex >= settings.script.scenes.length
              ? [settings.script.outro, settings.script.cta].filter(Boolean).join(" ")
              : (scene?.narration ?? "");
        return { text, start: t.start + 0.15, end: t.start + 0.15 + seg.seconds };
      })
      .filter((e): e is NonNullable<typeof e> => Boolean(e));
    const srt = buildSrt(srtEntries);
    const report = {
      renderId: render.id,
      kind: settings.kind,
      format: settings.format,
      style: settings.style,
      durationSeconds: Math.round(totalSeconds * 10) / 10,
      scenes: orderedPhotos.map((p, i) => ({
        photoId: p.id,
        roomLabel: p.roomLabel,
        category: p.category,
        virtuallyStaged: p.isStaged,
        aiEnhanced: p.isAiEnhanced,
        motion: clips.has(i) ? "ai-walkthrough" : template.motion[i % template.motion.length],
        startSeconds: Math.round((timings[i]?.start ?? 0) * 10) / 10,
        seconds: Math.round((timings[i]?.duration ?? 0) * 10) / 10,
        narration: settings.script.scenes[i]?.narration ?? "",
        caption: settings.script.scenes[i]?.caption ?? "",
      })),
      voice: { real: prepare?.voiceReal ?? false, lines: segments.length },
      disclosures: {
        aiEnhancedPhotos: orderedPhotos.some((p) => p.isAiEnhanced),
        virtuallyStagedPhotos: orderedPhotos.some((p) => p.isStaged),
        deterministicMotionOnly: clips.size === 0,
        aiMotionScenes: clips.size,
        aiMotionNote:
          clips.size > 0
            ? "Some visual motion in this video was generated using AI. Property features were not intentionally altered."
            : undefined,
      },
    };
    for (const [name, content, mime, type] of [
      [`Captions (SRT): ${project?.name ?? "listing"}`, srt, "text/plain", "TEXT"],
      [`Generation report: ${project?.name ?? "listing"}`, JSON.stringify(report, null, 2), "application/json", "JSON"],
    ] as const) {
      if (!content) continue;
      const key = `${organizationId}/${render.projectId}/render-${render.id}-${type === "TEXT" ? "captions.srt" : "report.json"}`;
      const s = await storage.put(key, content, { contentType: mime });
      await prisma.asset.create({
        data: {
          organizationId,
          name,
          type,
          mimeType: mime,
          storageDriver: storage.driver,
          storageKey: s.key,
          sizeBytes: s.sizeBytes,
          moduleKey: MODULE_KEY,
          source: "workflow:listing-factory-render:assemble",
          approvalStatus: "PENDING_REVIEW",
          metadata: {
            renderId: render.id,
            projectId: render.projectId,
            role: type === "TEXT" ? "captions-srt" : "report",
          } as Prisma.InputJsonValue,
        },
      });
    }

    await prisma.listingRender.update({
      where: { id: render.id },
      data: { status: "COMPLETED", videoAssetId: videoAsset.id, error: null },
    });
    await prisma.listingProject.update({
      where: { id: render.projectId },
      data: { status: "READY" },
    });
    return {
      renderId,
      videoAssetId: videoAsset.id,
      durationSeconds: Math.round(totalSeconds),
      sceneCount: orderedPhotos.length,
      isPreview,
    };
  } catch (err) {
    // Retryable step failures (e.g. clips still generating) get a fresh
    // attempt from the engine — the render is still live, not failed.
    if (err instanceof PlatformError && err.retryable) throw err;
    await prisma.listingRender.update({
      where: { id: render.id },
      data: { status: "FAILED", error: String((err as Error).message ?? err).slice(0, 500) },
    });
    await prisma.listingProject.update({
      where: { id: render.projectId },
      data: { status: "FAILED" },
    });
    throw err;
  }
});

// ─── ffmpeg assembly ─────────────────────────────────────────────────────────

interface OverlayInput {
  assetId: string;
  role: "caption" | "facts" | "outro" | "watermark" | "cover";
  sceneIndex?: number;
  data: Buffer;
}

function motionFilter(
  preset: MotionPreset,
  template: VideoTemplate,
  frames: number,
  width: number,
  height: number,
  fps: number,
): string {
  const zMax = template.zoomAmount;
  const rate = ((zMax - 1) / Math.max(1, frames)).toFixed(6);
  const centered = `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'`;
  switch (preset) {
    case "zoom-in":
      return `zoompan=z='min(1+${rate}*on,${zMax})':d=${frames}:${centered}:s=${width}x${height}:fps=${fps}`;
    case "push-in":
      // Slightly stronger, slightly eased push toward the center.
      return `zoompan=z='min(1+${(Number(rate) * 1.25).toFixed(6)}*on,${(zMax + 0.02).toFixed(3)})':d=${frames}:${centered}:s=${width}x${height}:fps=${fps}`;
    case "zoom-out":
      return `zoompan=z='max(${zMax}-${rate}*on,1.0)':d=${frames}:${centered}:s=${width}x${height}:fps=${fps}`;
    case "pan-lr":
      return `zoompan=z=${zMax}:d=${frames}:x='(iw-iw/zoom)*on/${frames}':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`;
    case "pan-rl":
      return `zoompan=z=${zMax}:d=${frames}:x='(iw-iw/zoom)*(1-on/${frames})':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}`;
  }
}

function assembleVideo(params: {
  settings: RenderSettings;
  template: VideoTemplate;
  isPreview: boolean;
  photoBuffers: Buffer[];
  /** AI walkthrough clips by scene index; other scenes get Ken Burns. */
  clips: Map<number, Buffer>;
  overlays: OverlayInput[];
  segments: { sceneIndex: number; data: Buffer }[];
  timings: SceneTiming[];
  totalSeconds: number;
  useOutroCard: boolean;
  musicOn: boolean;
}): Buffer {
  const { template, timings, totalSeconds } = params;
  const format = VIDEO_FORMATS[params.settings.format];
  const scale = params.isPreview ? 0.5 : 1;
  const W = Math.round(format.width * scale);
  const H = Math.round(format.height * scale);
  const fps = 24;
  const fade = template.transitionSeconds;

  const ffmpegPath = resolveFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), "lvf-"));
  try {
    const inputs: string[] = [];
    let inputIndex = 0;
    const idx = { photos: [] as number[], overlays: new Map<string, number>(), audio: [] as { sceneIndex: number; index: number }[], music: -1 };

    // Scene inputs — an AI walkthrough clip when one is ready, the still
    // photo otherwise. The outro card reuses the final photo as backdrop.
    const photoCount = params.photoBuffers.length;
    const sceneBuffers = [...params.photoBuffers];
    if (params.useOutroCard) sceneBuffers.push(params.photoBuffers[photoCount - 1]!);
    const isClipScene = (i: number): boolean =>
      params.clips.has(i) && !(params.useOutroCard && i === sceneBuffers.length - 1);
    for (let i = 0; i < sceneBuffers.length; i++) {
      if (isClipScene(i)) {
        const file = path.join(dir, `clip${i}.mp4`);
        writeFileSync(file, params.clips.get(i)!);
        inputs.push("-i", file);
      } else {
        const file = path.join(dir, `photo${i}.img`);
        writeFileSync(file, sceneBuffers[i]!);
        inputs.push("-i", file);
      }
      idx.photos.push(inputIndex++);
    }
    // Overlay PNGs, looped so `enable` windows can address any time.
    for (const ov of params.overlays) {
      const file = path.join(dir, `ov-${idx.overlays.size}.png`);
      writeFileSync(file, ov.data);
      inputs.push("-loop", "1", "-i", file);
      idx.overlays.set(ov.assetId, inputIndex++);
    }
    // Voice segments.
    for (const seg of params.segments) {
      const file = path.join(dir, `voice-${seg.sceneIndex}.mp3`);
      writeFileSync(file, seg.data);
      inputs.push("-i", file);
      idx.audio.push({ sceneIndex: seg.sceneIndex, index: inputIndex++ });
    }
    // Music bed.
    if (params.musicOn) {
      const file = path.join(dir, "music.wav");
      writeFileSync(file, synthMusic(template.musicStyle, totalSeconds));
      inputs.push("-i", file);
      idx.music = inputIndex++;
    }

    const filters: string[] = [];

    // Scene streams with motion. Oversample ~1.3x before zoompan to avoid
    // the shimmering it produces at 1:1 scale.
    const ow = Math.round(W * 1.3);
    const oh = Math.round(H * 1.3);
    for (let i = 0; i < sceneBuffers.length; i++) {
      const duration = timings[i]?.duration ?? 3;
      const frames = Math.max(1, Math.round(duration * fps));
      if (isClipScene(i)) {
        // Gentle time-stretch so the ~5.3s clip fills the scene slot, then
        // clone-pad as a safety net and trim exactly. fps last: xfade needs
        // CFR inputs and tpad/trim drop the rate.
        const stretch = Math.min(2.2, Math.max(0.75, duration / HF_CLIP_SECONDS));
        filters.push(
          `[${idx.photos[i]}:v]setpts=${stretch.toFixed(4)}*PTS,` +
            `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
            `tpad=stop_mode=clone:stop_duration=10,trim=duration=${duration.toFixed(2)},` +
            `setpts=PTS-STARTPTS,fps=${fps},setsar=1[v${i}]`,
        );
        continue;
      }
      const preset =
        i === sceneBuffers.length - 1 && params.useOutroCard
          ? "zoom-in"
          : template.motion[i % template.motion.length]!;
      filters.push(
        `[${idx.photos[i]}:v]scale=${ow}:${oh}:force_original_aspect_ratio=increase,crop=${ow}:${oh},` +
          `${motionFilter(preset, template, frames, W, H, fps)},setsar=1[v${i}]`,
      );
    }

    // Crossfade chain with the template's transition cycle.
    let last = "v0";
    for (let i = 1; i < sceneBuffers.length; i++) {
      const out = i === sceneBuffers.length - 1 ? "vseq" : `x${i}`;
      const transition = template.transitions[(i - 1) % template.transitions.length]!;
      const offset = Math.max(0, (timings[i]?.start ?? 0)).toFixed(3);
      filters.push(
        `[${last}][v${i}]xfade=transition=${transition}:duration=${fade}:offset=${offset}[${out}]`,
      );
      last = out;
    }
    if (sceneBuffers.length === 1) filters.push(`[v0]copy[vseq]`);

    // Text overlays (full-frame transparent PNGs), scaled to the output.
    let chain = "vseq";
    let ovOut = 0;
    const overlayWindow = (sceneIndex: number): { from: number; to: number } => {
      const t = timings[sceneIndex];
      if (!t) return { from: 0, to: 0 };
      const pad = Math.min(fade * 0.6, 0.4);
      return { from: t.start + pad, to: t.start + t.duration - pad };
    };
    const applyOverlay = (assetId: string, enable?: string): void => {
      const src = idx.overlays.get(assetId);
      if (src === undefined) return;
      const out = `ov${ovOut++}`;
      filters.push(
        `[${src}:v]scale=${W}:${H},format=rgba[o${out}]`,
        `[${chain}][o${out}]overlay=0:0${enable ? `:enable='${enable}'` : ""}[${out}]`,
      );
      chain = out;
    };
    for (const ov of params.overlays) {
      if (ov.role === "caption" && ov.sceneIndex !== undefined) {
        const { from, to } = overlayWindow(ov.sceneIndex);
        if (to > from) applyOverlay(ov.assetId, `between(t,${from.toFixed(2)},${to.toFixed(2)})`);
      } else if (ov.role === "facts") {
        const sceneIndex = Math.min(1, photoCount - 1);
        const { from, to } = overlayWindow(sceneIndex);
        if (to > from) applyOverlay(ov.assetId, `between(t,${from.toFixed(2)},${to.toFixed(2)})`);
      } else if (ov.role === "outro" && params.useOutroCard) {
        const t = timings[timings.length - 1]!;
        applyOverlay(ov.assetId, `gte(t,${(t.start + 0.2).toFixed(2)})`);
      } else if (ov.role === "watermark") {
        applyOverlay(ov.assetId);
      }
    }
    filters.push(
      `[${chain}]fade=t=in:d=0.5,fade=t=out:st=${Math.max(0, totalSeconds - 0.7).toFixed(2)}:d=0.7,fps=${fps}[vfinal]`,
    );

    // Audio graph: voice lines placed at their scene starts, quiet synth bed
    // ducked under the voice with a sidechain compressor.
    const voiceLabels: string[] = [];
    for (const a of idx.audio) {
      const t = timings[a.sceneIndex];
      const delayMs = Math.max(0, Math.round(((t?.start ?? 0) + 0.15) * 1000));
      const label = `vo${voiceLabels.length}`;
      // Normalize rate/layout so amix never downgrades to a mock clip's 8kHz.
      filters.push(
        `[${a.index}:a]aresample=44100,aformat=channel_layouts=mono,adelay=${delayMs}:all=1[${label}]`,
      );
      voiceLabels.push(label);
    }
    let audioOut: string | null = null;
    if (voiceLabels.length > 0 && idx.music >= 0) {
      filters.push(
        voiceLabels.length === 1
          ? `[${voiceLabels[0]}]acopy[voice]`
          : `[${voiceLabels.join("][")}]amix=inputs=${voiceLabels.length}:duration=longest:normalize=0[voice]`,
        `[${idx.music}:a]volume=${template.musicVolume}[bed]`,
        `[voice]asplit[voiceMix][voiceKey]`,
        `[bed][voiceKey]sidechaincompress=threshold=0.03:ratio=6:attack=120:release=900[bedDucked]`,
        `[voiceMix][bedDucked]amix=inputs=2:duration=longest:normalize=0[apre]`,
      );
      audioOut = "apre";
    } else if (voiceLabels.length > 0) {
      filters.push(
        voiceLabels.length === 1
          ? `[${voiceLabels[0]}]acopy[apre]`
          : `[${voiceLabels.join("][")}]amix=inputs=${voiceLabels.length}:duration=longest:normalize=0[apre]`,
      );
      audioOut = "apre";
    } else if (idx.music >= 0) {
      filters.push(`[${idx.music}:a]volume=${template.musicVolume * 2}[apre]`);
      audioOut = "apre";
    }
    if (audioOut) {
      filters.push(
        `[${audioOut}]apad,atrim=duration=${totalSeconds.toFixed(2)},afade=t=out:st=${Math.max(0, totalSeconds - 1.2).toFixed(2)}:d=1.2[afinal]`,
      );
    }

    const outFile = path.join(dir, "out.mp4");
    execFileSync(
      ffmpegPath,
      [
        "-y",
        ...inputs,
        "-filter_complex",
        filters.join(";"),
        "-map",
        "[vfinal]",
        ...(audioOut ? ["-map", "[afinal]"] : []),
        "-c:v",
        "libx264",
        "-preset",
        params.isPreview ? "ultrafast" : "veryfast",
        "-crf",
        params.isPreview ? "28" : "21",
        "-pix_fmt",
        "yuv420p",
        "-t",
        totalSeconds.toFixed(2),
        ...(audioOut ? ["-c:a", "aac", "-b:a", "128k"] : []),
        "-movflags",
        "+faststart",
        outFile,
      ],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 270_000 },
    );
    return readFileSync(outFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Royalty-free synthesized music beds (generated in JS — no licensing
 * concerns). Three styles keyed by template: warm pads, a brighter plucked
 * pattern, and a sparse minimal bed.
 */
export function synthMusic(style: "warm" | "bright" | "minimal", seconds: number): Buffer {
  const rate = 44100;
  const totalSamples = Math.ceil(seconds * rate);
  const pcm = new Int16Array(totalSamples);
  const chords: number[][] = [
    [261.63, 329.63, 392.0], // C
    [220.0, 261.63, 329.63], // Am
    [174.61, 220.0, 261.63], // F
    [196.0, 246.94, 293.66], // G
  ];
  const chordLen = style === "bright" ? 2.0 : 4.0;
  for (let s = 0; s < totalSamples; s++) {
    const t = s / rate;
    const chord = chords[Math.floor(t / chordLen) % chords.length]!;
    const tin = t % chordLen;
    let sample = 0;
    if (style === "bright") {
      // Plucked eighth-note arpeggio with a soft pad underneath.
      const noteLen = 0.25;
      const note = chord[Math.floor(tin / noteLen) % chord.length]! * 2;
      const nt = tin % noteLen;
      sample += Math.sin(2 * Math.PI * note * nt) * Math.exp(-6 * nt) * 0.5;
      const env = Math.min(1, tin / 0.4) * Math.min(1, (chordLen - tin) / 0.4);
      for (const f of chord) sample += Math.sin(2 * Math.PI * f * t) * 0.1 * env;
    } else if (style === "minimal") {
      // Sparse: root + fifth only, long swells, half the chords silent-ish.
      const env = Math.min(1, tin / 1.6) * Math.min(1, (chordLen - tin) / 1.6);
      sample += Math.sin(2 * Math.PI * chord[0]! * t) * 0.3 * env;
      sample += Math.sin(2 * Math.PI * chord[2]! * t) * 0.12 * env;
    } else {
      // Warm pad triads with slow swell.
      const env = Math.min(1, tin / 1.2) * Math.min(1, (chordLen - tin) / 1.2);
      for (const f of chord) {
        sample += Math.sin(2 * Math.PI * f * t) * 0.26 + Math.sin(2 * Math.PI * f * 2 * t) * 0.05;
      }
      sample *= env * 0.45;
      pcm[s] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
      continue;
    }
    pcm[s] = Math.max(-32768, Math.min(32767, Math.round(sample * 0.5 * 32767)));
  }
  return pcmToWav(pcm, rate);
}
