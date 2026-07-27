import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { ASSETS_DIR, loadConfig } from "../config";
import { ensureDir } from "../utils/fs";
import { log } from "../utils/log";
import { type RenderPlan } from "./render-plan";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Locate a Chromium binary (pre-installed Playwright browsers, or env override). */
export function findBrowserExecutable(): string | undefined {
  const env = loadConfig();
  const candidates = [
    env.REMOTION_BROWSER_EXECUTABLE,
    // Prefer the headless shell: modern full-Chromium builds removed the old
    // headless mode Remotion drives.
    "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell",
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) {
    try {
      if (existsSync(c) && statSync(c).isFile()) return c;
    } catch {
      // ignore
    }
  }
  return undefined; // Remotion will download its own headless shell
}

let bundleCache: string | null = null;

/**
 * Drop the cached webpack bundle. The bundle SNAPSHOTS the assets dir, so any
 * step that adds asset files mid-process (e.g. motion clips) must reset before
 * the next render.
 */
export function resetBundleCache(): void {
  bundleCache = null;
}

export async function bundleComposition(): Promise<string> {
  if (bundleCache) return bundleCache;
  log.info("bundling Remotion composition…");
  bundleCache = await bundle({
    entryPoint: path.join(here, "remotion-entry.ts"),
    publicDir: ASSETS_DIR,
    onProgress: () => undefined,
  });
  return bundleCache;
}

export interface RenderResult {
  file: string;
  seconds: number;
}

export async function renderEpisodeVideo(params: {
  plan: RenderPlan;
  outFile: string;
  /** Draft renders at half resolution with a faster CRF. */
  draft: boolean;
}): Promise<RenderResult> {
  const { plan, outFile, draft } = params;
  const serveUrl = await bundleComposition();
  const browserExecutable = findBrowserExecutable();
  const inputProps = { plan };

  const composition = await selectComposition({
    serveUrl,
    id: "Episode",
    inputProps,
    browserExecutable,
  });

  ensureDir(path.dirname(outFile));
  log.info(
    `rendering ${draft ? "draft" : "final"} ${composition.width}x${composition.height} · ` +
      `${composition.durationInFrames} frames @ ${composition.fps}fps`,
  );
  let lastPct = -10;
  await renderMedia({
    serveUrl,
    composition,
    codec: "h264",
    outputLocation: outFile,
    inputProps,
    browserExecutable,
    scale: draft ? 0.5 : 1,
    crf: draft ? 28 : 19,
    concurrency: 2,
    chromiumOptions: { gl: "angle-egl" },
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= lastPct + 10) {
        lastPct = pct;
        log.info(`render ${pct}%`);
      }
    },
  });
  return { file: outFile, seconds: composition.durationInFrames / composition.fps };
}

/** Locate the static ffmpeg binary shipped by the workspace's ffmpeg-static dep. */
function resolveFfmpeg(): string {
  if (process.env.FFMPEG_PATH && existsSync(process.env.FFMPEG_PATH))
    return process.env.FFMPEG_PATH;
  const suffix = "node_modules/ffmpeg-static/ffmpeg";
  // here = <app>/src/render; the repo root (with the pnpm store) is 4 levels up.
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), "../.."),
    path.resolve(here, "../../../.."),
  ];
  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(path.join(root, suffix));
    const pnpmDir = path.join(root, "node_modules/.pnpm");
    try {
      for (const entry of readdirSync(pnpmDir)) {
        if (entry.startsWith("ffmpeg-static@")) candidates.push(path.join(pnpmDir, entry, suffix));
      }
    } catch {
      // no pnpm store at this root
    }
  }
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        chmodSync(c, 0o755);
      } catch {
        // already executable
      }
      return c;
    }
  }
  throw new Error("ffmpeg binary not found (ffmpeg-static); set FFMPEG_PATH to override");
}

/**
 * Web-optimized 720x1280 preview of a rendered episode — small enough to
 * commit into apps/web/public so the dashboard can stream it.
 */
export function transcodeWebPreview(inFile: string, outFile: string): string {
  ensureDir(path.dirname(outFile));
  execFileSync(
    resolveFfmpeg(),
    [
      "-y",
      "-i",
      inFile,
      "-vf",
      "scale=720:1280",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "27",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      "-movflags",
      "+faststart",
      outFile,
    ],
    { stdio: ["ignore", "ignore", "pipe"], timeout: 300_000 },
  );
  return outFile;
}

/**
 * Clean-plate still of one scene (no subtitles/chip/hook overlays) — the
 * source frame for image-to-video motion generation.
 */
export async function renderSceneStill(
  plan: RenderPlan,
  sceneIndex: number,
  outFile: string,
): Promise<string> {
  const serveUrl = await bundleComposition();
  const browserExecutable = findBrowserExecutable();
  const scene = plan.scenes.find((s) => s.index === sceneIndex);
  if (!scene) throw new Error(`No scene ${sceneIndex} in render plan`);
  const cleanPlan: RenderPlan = { ...plan, cleanPlate: true };
  const composition = await selectComposition({
    serveUrl,
    id: "Episode",
    inputProps: { plan: cleanPlan },
    browserExecutable,
  });
  ensureDir(path.dirname(outFile));
  await renderStill({
    serveUrl,
    composition,
    output: outFile,
    frame: Math.min(
      scene.startFrame + Math.floor(scene.durationFrames * 0.4),
      composition.durationInFrames - 1,
    ),
    inputProps: { plan: cleanPlan },
    browserExecutable,
    chromiumOptions: { gl: "angle-egl" },
  });
  return outFile;
}

/** Thumbnail: a frame from the twist scene (most dramatic) or the hook. */
export async function renderThumbnail(plan: RenderPlan, outFile: string): Promise<string> {
  const serveUrl = await bundleComposition();
  const browserExecutable = findBrowserExecutable();
  const twist = plan.scenes.find((s) => s.slot === "twist") ?? plan.scenes[0];
  const frame = twist ? twist.startFrame + Math.floor(twist.durationFrames * 0.6) : 0;
  const composition = await selectComposition({
    serveUrl,
    id: "Episode",
    inputProps: { plan },
    browserExecutable,
  });
  ensureDir(path.dirname(outFile));
  await renderStill({
    serveUrl,
    composition,
    output: outFile,
    frame: Math.min(frame, composition.durationInFrames - 1),
    inputProps: { plan },
    browserExecutable,
    chromiumOptions: { gl: "angle-egl" },
  });
  return outFile;
}
