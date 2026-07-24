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
    "Adorable chubby 3D-rendered baby animal character, huge sparkly eyes, soft rounded shapes, " +
    "pastel rainbow colors, glossy toddler-animation style like modern 3D nursery rhyme cartoons, " +
    "soft cinematic lighting, cheerful zoo playground background, no text, no words, no letters";
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
  const voice = await providers.audio.generateSpeech({
    text: narration,
    style:
      "Sing-song nursery-rhyme delivery for toddlers: melodic, bouncy, rhythmic like a children's song, " +
      "gentle and joyful, slightly slower pace, playful emphasis on repeated sound words",
  });
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
    videoData = assembleNurseryVideo(imageBuffers, voice.data, audioSeconds);
    videoMeta = {
      provider: "ffmpeg-kenburns-music",
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
  const suffix = "node_modules/ffmpeg-static/ffmpeg";
  const roots = [process.cwd(), path.join(process.cwd(), "../.."), "/var/task"];
  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.join(root, suffix));
    const pnpmDir = path.join(root, "node_modules/.pnpm");
    try {
      for (const entry of readdirSync(pnpmDir)) {
        if (entry.startsWith("ffmpeg-static@")) {
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

/**
 * Nursery-rhyme assembly: slow Ken Burns zoom on every scene, 0.6s
 * crossfades, sung voice-over, and a soft synthesized music-box arpeggio
 * underneath (generated with ffmpeg — no licensed audio involved).
 */
function assembleNurseryVideo(images: Buffer[], audio: Buffer, audioSeconds: number): Buffer {
  const ffmpegPath = resolveFfmpeg();
  const dir = mkdtempSync(path.join(os.tmpdir(), "zoo-"));
  try {
    const n = images.length;
    const fade = 0.6;
    const total = audioSeconds + 1.2;
    // Every clip has the same length; crossfades overlap them.
    const clipLen = (total + (n - 1) * fade) / n;
    const fps = 24;
    const frames = Math.ceil(clipLen * fps);

    const inputs: string[] = [];
    images.forEach((img, i) => {
      const file = path.join(dir, `img${i}.png`);
      writeFileSync(file, img);
      inputs.push("-i", file);
    });
    const audioFile = path.join(dir, "voice.mp3");
    writeFileSync(audioFile, audio);
    const outFile = path.join(dir, "out.mp4");

    // Ken Burns per still: gentle zoom-in, alternating with zoom-out.
    const filters: string[] = [];
    for (let i = 0; i < n; i++) {
      const zoomExpr =
        i % 2 === 0
          ? `min(1+0.0018*on,1.14)` // zoom in
          : `max(1.14-0.0018*on,1.0)`; // zoom out
      filters.push(
        `[${i}:v]scale=1400:2489:force_original_aspect_ratio=increase,crop=1400:2489,` +
          `zoompan=z='${zoomExpr}':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=${fps}[v${i}]`,
      );
    }
    // Chain crossfades.
    let last = "v0";
    for (let i = 1; i < n; i++) {
      const out = i === n - 1 ? "vout" : `x${i}`;
      const offset = (i * (clipLen - fade)).toFixed(2);
      filters.push(`[${last}][v${i}]xfade=transition=fade:duration=${fade}:offset=${offset}[${out}]`);
      last = out;
    }
    if (n === 1) filters.push(`[v0]copy[vout]`);

    // Soft music-box bed synthesized in JS (no licensed audio, no ffmpeg
    // expression parsing) — mixed under the sung voice-over.
    const musicFile = path.join(dir, "music.wav");
    writeFileSync(musicFile, synthMusicBoxWav(total));
    filters.push(`[${n}:a]volume=1.0[voice]`);
    filters.push(
      `[${n + 1}:a]volume=0.16,afade=t=in:d=1,afade=t=out:st=${Math.max(0, total - 1.5).toFixed(2)}:d=1.5[music]`,
    );
    filters.push(`[voice][music]amix=inputs=2:duration=first:normalize=0[aout]`);

    execFileSync(
      ffmpegPath,
      [
        "-y",
        ...inputs,
        "-i", audioFile,
        "-i", musicFile,
        "-filter_complex", filters.join(";"),
        "-map", "[vout]", "-map", "[aout]",
        "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
        "-t", total.toFixed(2),
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
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
  const dataSize = pcm.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}
