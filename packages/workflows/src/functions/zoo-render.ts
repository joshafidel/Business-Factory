import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordCost } from "@bf/agents";
import { prisma, type Prisma } from "@bf/database";
import { getMediaProviders } from "@bf/providers";
import { getStorage } from "@bf/storage";
import { createLogger } from "@bf/shared";
import { registerCodeFunction, readPath } from "../definitions";

const log = createLogger("zoo-render");

/**
 * Zoo Shorts renderer (CODE_FUNCTION "render_zoo_short").
 *
 * With OPENAI_API_KEY set: one gpt-image illustration per scene (generated in
 * parallel), a gpt-4o-mini-tts voice-over, and an ffmpeg-assembled 1080x1920
 * MP4 slideshow synced to the narration. Without it: local mocks keep the
 * pipeline alive and the video is flagged placeholder (never uploaded).
 */
registerCodeFunction("render_zoo_short", async (args, context) => {
  const organizationId = String(args.organizationId ?? "");
  const workflowRunId = String(args.workflowRunId ?? "");
  const script = readPath(context, "$.steps.script") as {
    scenes?: { narration?: string; visual?: string }[];
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

  // Scene images — parallel; serverless wall-clock matters.
  const style =
    "Bright, friendly children's cartoon illustration, soft shapes, cheerful zoo setting, no text, no words";
  const images = await Promise.all(
    scenes.map((scene, i) =>
      providers.image
        .generateImage({ prompt: `${scene?.visual ?? "happy zoo animal"}. ${style}` })
        .then((r) => ({ i, r })),
    ),
  );
  const imageBuffers: Buffer[] = [];
  for (const { i, r } of images.sort((a, b) => a.i - b.i)) {
    totalCost += r.costMicroUsd;
    imageBuffers.push(r.data);
    await save(
      `Scene ${i + 1}: ${(scenes[i]?.visual ?? "").slice(0, 60)}`,
      "IMAGE",
      r.mimeType,
      r.data,
      { sceneIndex: i, visual: scenes[i]?.visual, provider: providers.image.key },
    );
  }

  // Voice-over.
  const narration = [...scenes.map((s) => s?.narration ?? ""), script?.outro ?? ""]
    .filter(Boolean)
    .join(" ");
  const voice = await providers.audio.generateSpeech({ text: narration });
  totalCost += voice.costMicroUsd;
  await save(`Voice-over: ${title.slice(0, 60)}`, "AUDIO", voice.mimeType, voice.data, {
    chars: narration.length,
    provider: providers.audio.key,
  });

  // Video.
  let videoData: Buffer;
  let videoMeta: Record<string, unknown>;
  if (providers.real && imageBuffers.length > 0) {
    const audioSeconds = await mp3DurationSeconds(voice.data, narration.length);
    videoData = assembleSlideshow(imageBuffers, voice.data, audioSeconds);
    videoMeta = {
      provider: "ffmpeg-slideshow",
      placeholder: false,
      sceneCount: scenes.length,
      durationSeconds: Math.round(audioSeconds),
    };
  } else {
    const rendered = await providers.video.generateVideo({ prompt: title });
    videoData = rendered.data;
    videoMeta = { provider: providers.video.key, placeholder: true, sceneCount: scenes.length };
  }
  const videoAssetId = await save(
    `Video: ${title.slice(0, 80)}`,
    "VIDEO",
    "video/mp4",
    videoData,
    videoMeta,
  );

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
    videoAssetId,
    assetIds,
    sceneCount: scenes.length,
    isPlaceholder: !(providers.real && imageBuffers.length > 0),
    // Engine folds this into the run's total cost (limits included).
    _costMicroUsd: totalCost.toString(),
  };
});

/** Read MP3 duration; falls back to a speech-rate estimate on parse failure. */
async function mp3DurationSeconds(data: Buffer, chars: number): Promise<number> {
  try {
    const { parseBuffer } = await import("music-metadata");
    const meta = await parseBuffer(new Uint8Array(data), { mimeType: "audio/mpeg" });
    if (meta.format.duration && meta.format.duration > 1) return meta.format.duration;
  } catch (err) {
    log.warn({ err }, "mp3 duration parse failed; estimating");
  }
  return Math.max(10, chars / 15); // ~15 chars/second of narration
}

/**
 * Stitch stills + voice-over into a 1080x1920 MP4. Runs ffmpeg synchronously
 * in a temp dir; low fps + stillimage tune keeps encode time serverless-safe.
 */
/**
 * Locate the ffmpeg binary without importing @ffmpeg-installer/ffmpeg —
 * its index.js throws at import time when bundled, so we resolve the traced
 * platform binary from the filesystem (pnpm store layouts, local + Vercel).
 */
function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH)) {
    return process.env.FFMPEG_PATH;
  }
  const suffix = `node_modules/@ffmpeg-installer/${process.platform}-${process.arch}/ffmpeg`;
  const roots = [process.cwd(), path.join(process.cwd(), "../.."), "/var/task"];
  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.join(root, suffix));
    const pnpmDir = path.join(root, "node_modules/.pnpm");
    try {
      for (const entry of readdirSync(pnpmDir)) {
        if (entry.startsWith("@ffmpeg-installer+")) {
          candidates.push(path.join(pnpmDir, entry, suffix));
        }
      }
    } catch {
      // root has no pnpm store — skip
    }
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        chmodSync(candidate, 0o755);
      } catch {
        // already executable
      }
      return candidate;
    }
  }
  throw new Error(`ffmpeg binary not found; searched ${candidates.length} locations`);
}

function assembleSlideshow(images: Buffer[], audio: Buffer, audioSeconds: number): Buffer {
  const ffmpegPath = resolveFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), "zoo-"));
  try {
    const perImage = Math.max(2, audioSeconds / images.length);
    const listLines: string[] = [];
    images.forEach((img, i) => {
      const file = path.join(dir, `img${i}.png`);
      writeFileSync(file, img);
      listLines.push(`file '${file}'`, `duration ${perImage.toFixed(2)}`);
    });
    // concat demuxer needs the last file repeated without a duration
    listLines.push(`file '${path.join(dir, `img${images.length - 1}.png`)}'`);
    const listFile = path.join(dir, "list.txt");
    writeFileSync(listFile, listLines.join("\n"));
    const audioFile = path.join(dir, "voice.mp3");
    writeFileSync(audioFile, audio);
    const outFile = path.join(dir, "out.mp4");

    execFileSync(
      ffmpegPath,
      [
        "-y",
        "-f", "concat", "-safe", "0", "-i", listFile,
        "-i", audioFile,
        "-c:v", "libx264", "-preset", "ultrafast", "-tune", "stillimage",
        "-r", "12", "-pix_fmt", "yuv420p",
        "-vf",
        "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=white",
        "-c:a", "aac", "-b:a", "128k",
        "-shortest", "-movflags", "+faststart",
        outFile,
      ],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 180_000 },
    );
    return readFileSync(outFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
