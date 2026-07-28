import { chmodSync, existsSync, readdirSync } from "node:fs";
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
