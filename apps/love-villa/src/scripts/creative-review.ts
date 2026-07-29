import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadCast } from "../characters/character-manager";
import { loadEpisodeScript } from "../episodes/episode-generator";
import {
  creativeReportFile,
  entertainmentPasses,
  lookPasses,
  reviewCinematography,
  reviewEntertainment,
  reviewLook,
  sampleClipFramePairs,
} from "../quality/creative-director";
import { loadRenderPlan } from "../render/render-plan";
import { loadShowBible } from "../show/show-bible";
import { parseArgs } from "../utils/args";
import { CostTracker } from "../utils/cost";
import { writeJson } from "../utils/fs";
import { log } from "../utils/log";

/**
 * npm run creative-review -- --episode N [--free-only]
 *
 * The Creative Director's inspection (owner criteria, docs/DIRECTIVES-V3.md):
 * entertainment, cinematography (free/deterministic), backgrounds, motion
 * restraint. --free-only runs just the zero-cost cinematography checks —
 * safe under a spending freeze.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = Number(args.episode);
  if (!Number.isInteger(episode) || episode < 1) throw new Error("Pass --episode N");
  const freeOnly = args["free-only"] === true;
  const tracker = new CostTracker({ episode });
  const report: Record<string, unknown> = { episode, at: new Date().toISOString() };

  log.step(`Creative Director — episode ${episode}${freeOnly ? " (free checks only)" : ""}`);

  const plan = loadRenderPlan(episode);
  const cinema = reviewCinematography(plan);
  report.cinematography = cinema;
  for (const f of cinema) {
    (f.severity === "critical" ? log.warn : log.info)(`[camera] scene ${f.scene + 1}: ${f.issue}`);
  }
  if (cinema.length === 0) log.ok("cinematography clean");

  if (!freeOnly) {
    const script = loadEpisodeScript(episode);
    const ent = await reviewEntertainment({
      script,
      bible: loadShowBible(),
      cast: loadCast(),
      tracker,
    });
    report.entertainment = ent;
    log.info(
      `entertainment: ${ent.verdict} (watch-next ${ent.scores.wouldWatchNext}, reversal ${ent.scores.reversal})`,
    );
    for (const w of ent.whyAViewerWouldScrollAway) log.warn(`[story] ${w}`);

    const frameDir = mkdtempSync(path.join(os.tmpdir(), "creative-frames-"));
    const frames = sampleClipFramePairs(episode, plan, frameDir);
    if (frames.length > 0) {
      const look = await reviewLook({ episode, images: frames.slice(0, 12), tracker });
      report.look = look;
      const flail = look.frames.filter((f) => f.motionAmplitude === "flailing").length;
      const wall = look.frames.filter((f) => f.backgroundGrade === "wallpaper").length;
      log.info(`look: ${flail} flailing frame(s), ${wall} wallpaper frame(s)`);
      if (!lookPasses(look)) log.warn("look review below the bar");
    }
    if (!entertainmentPasses(ent)) {
      log.warn("entertainment below the bar — regenerate the script from a stronger pitch");
    }
  }

  writeJson(creativeReportFile(episode), report);
  const critical = cinema.some((f) => f.severity === "critical");
  log.ok(`creative-report.json written${critical ? " — CRITICAL camera findings present" : ""}`);
  if (critical) process.exit(1);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
