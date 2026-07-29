import { chmodSync, existsSync, readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";

const log = createLogger("media-utils");

/** Public URL external fetchers (e.g. Higgsfield) can reach this deploy on. */
export function publicBaseUrl(): string | undefined {
  const env = loadEnv();
  if (env.APP_BASE_URL) return env.APP_BASE_URL.replace(/\/$/, "");
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return `https://${prod}`;
  return undefined;
}

/**
 * Helpers shared by the module video renderers (zoo shorts, listing tours):
 * locating the traced ffmpeg binary and reading audio durations.
 */

/**
 * Locate the ffmpeg binary without importing @ffmpeg-installer/ffmpeg —
 * its index.js throws at import time when bundled, so we resolve the traced
 * platform binary from the filesystem (pnpm store layouts, local + Vercel).
 */
export function resolveFfmpeg(): string {
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

/** Read MP3 duration; falls back to a speech-rate estimate on parse failure. */
export async function mp3DurationSeconds(data: Buffer, chars: number): Promise<number> {
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
 * Downscale an image to QA size (~512px wide). Visual QA needs composition
 * and anatomy, not pixels — smaller frames keep vision-token cost tiny.
 */
export function downscaleForQa(image: Buffer): Buffer {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qa-img-"));
  try {
    const inFile = path.join(dir, "in.png");
    const outFile = path.join(dir, "out.png");
    writeFileSync(inFile, image);
    execFileSync(
      resolveFfmpeg(),
      ["-y", "-i", inFile, "-vf", "scale=512:-2", "-frames:v", "1", outFile],
      { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 },
    );
    return readFileSync(outFile);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Sample `count` evenly spaced frames from a video clip as small PNGs
 * (~512px wide) for visual QA — first, interior, and last-ish frames so
 * object-permanence breaks between frames are visible to the critic.
 */
export function extractQaFrames(video: Buffer, count = 4): Buffer[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "qa-clip-"));
  try {
    const inFile = path.join(dir, "in.mp4");
    writeFileSync(inFile, video);
    // Probe duration via ffmpeg (no ffprobe in ffmpeg-static): parse stderr.
    let durationSec = 5;
    try {
      execFileSync(resolveFfmpeg(), ["-i", inFile], { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 });
    } catch (err) {
      const stderr = String((err as { stderr?: Buffer }).stderr ?? "");
      const m = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (m) durationSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    const frames: Buffer[] = [];
    for (let i = 0; i < count; i++) {
      // 5%..90% — avoid the fade-to-black edges baked into scene renders.
      const t = durationSec * (0.05 + (0.85 * i) / Math.max(1, count - 1));
      const outFile = path.join(dir, `f${i}.png`);
      execFileSync(
        resolveFfmpeg(),
        ["-y", "-ss", t.toFixed(2), "-i", inFile, "-vf", "scale=512:-2", "-frames:v", "1", outFile],
        { stdio: ["ignore", "ignore", "pipe"], timeout: 30_000 },
      );
      frames.push(readFileSync(outFile));
    }
    return frames;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Measure real motion in `n` equal segments of a video: mean luma frame
 * difference (tblend=difference → signalstats YAVG) at 320px. Ken Burns
 * zooms measure well under ~1.0; genuine character animation measures
 * several times that — measured: dop-lite clip 9.7, Veo 5.5, zoompan <1.
 * This is the deterministic still-detector: frame LOOKS can't fool it.
 */
export function measureSegmentMotion(video: Buffer, n: number): number[] {
  const dir = mkdtempSync(path.join(os.tmpdir(), "motion-"));
  try {
    const f = path.join(dir, "v.mp4");
    writeFileSync(f, video);
    let durationSec = 0;
    try {
      execFileSync(resolveFfmpeg(), ["-i", f], { stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 });
    } catch (err) {
      const stderr = String((err as { stderr?: Buffer }).stderr ?? "");
      const m = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
      if (m) durationSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
    if (durationSec <= 0) return Array.from({ length: n }, () => -1);
    const seg = durationSec / n;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      // Trim 0.4s from each edge to skip the baked dip-to-black fades,
      // which register as large luma change on a static scene.
      const start = i * seg + 0.4;
      const len = Math.max(0.5, seg - 0.8);
      try {
        const res = execFileSync(
          "sh",
          [
            "-c",
            `"${resolveFfmpeg()}" -ss ${start.toFixed(2)} -t ${len.toFixed(2)} -i "${f}" ` +
              `-vf "scale=320:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG" ` +
              `-f null - 2>&1 | grep -oP "YAVG=\\K[0-9.]+"`,
          ],
          { timeout: 120_000 },
        ).toString();
        const vals = res.split("\n").filter(Boolean).map(Number);
        out.push(vals.length > 1 ? vals.slice(1).reduce((a, b) => a + b, 0) / (vals.length - 1) : 0);
      } catch {
        out.push(-1);
      }
    }
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Wrap raw 16-bit mono PCM samples into a WAV container. */
export function pcmToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataSize = pcm.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, Buffer.from(pcm.buffer)]);
}
