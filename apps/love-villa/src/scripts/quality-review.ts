import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { loadShowBible } from "../show/show-bible";
import { loadCast } from "../characters/character-manager";
import { loadEpisodeScript } from "../episodes/episode-generator";
import {
  hasCriticalFindings,
  loadQualityReport,
  logFindings,
  reviewAudio,
  reviewScript,
  reviewVisuals,
  saveQualityReport,
  scriptReviewPasses,
  summarizeReport,
} from "../quality/quality-director";
import { assetAbs, assetRel } from "../render/render-plan";
import { CostTracker } from "../utils/cost";
import { parseArgs } from "../utils/args";
import { episodeId } from "../utils/fs";
import { log } from "../utils/log";

/**
 * npm run quality-review -- --episode N
 *
 * The Quality Director's standalone inspection: re-runs the script rubric,
 * audio checks, and a visual pass over the episode's stills. Exit code 1 if
 * any critical finding remains — wire it into any approval you like.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = Number(args.episode);
  if (!Number.isInteger(episode) || episode < 1) throw new Error("Pass --episode N");
  const epId = episodeId(episode);
  const tracker = new CostTracker({ episode });
  const report = loadQualityReport(episode);

  log.step(`Quality Director — episode ${episode}`);

  let script = null;
  try {
    script = loadEpisodeScript(episode);
  } catch {
    /* no script yet */
  }
  if (script) {
    const review = await reviewScript({
      script,
      bible: loadShowBible(),
      cast: loadCast(),
      tracker,
    });
    report.script = { ...review, iterations: report.script?.iterations ?? 1 };
    log.info(
      `script verdict: ${review.verdict}${
        review.topProblems.length ? ` — ${review.topProblems.join(" | ")}` : ""
      }`,
    );
    if (!scriptReviewPasses(review)) {
      log.warn("script is below the bar — regenerate with: npm run generate-episode");
    }
  } else {
    log.warn("no script.json yet — skipping script review");
  }

  report.audio = { findings: reviewAudio(episode), checkedAt: new Date().toISOString() };

  const stillsDir = assetAbs(assetRel("episodes", epId, "stills"));
  if (existsSync(stillsDir)) {
    const stills = readdirSync(stillsDir)
      .filter((f) => f.endsWith(".png"))
      .sort()
      .slice(0, 8)
      .map((f) => ({ label: `still:${f}`, file: path.join(stillsDir, f) }));
    if (stills.length > 0) {
      const visual = await reviewVisuals({ episode, images: stills, tracker });
      report.visuals = [{ ...visual, checkedAt: new Date().toISOString() }];
    }
  } else {
    log.warn("no stills yet — skipping visual review");
  }

  saveQualityReport(report);
  logFindings(report);
  log.ok(`quality-report.json updated — ${summarizeReport(report)}`);
  if (hasCriticalFindings(report)) {
    log.error("CRITICAL findings present — fix and re-run before approving.");
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
