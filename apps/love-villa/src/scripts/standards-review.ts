import { loadCast } from "../characters/character-manager";
import { loadEpisodeScript } from "../episodes/episode-generator";
import { checkCharter, judgeScorecard, reviewScorecard } from "../quality/standards-officer";
import { loadRenderPlan, type RenderPlan } from "../render/render-plan";
import { loadShowBible } from "../show/show-bible";
import { parseArgs } from "../utils/args";
import { CostTracker } from "../utils/cost";
import { episodeId, writeJson } from "../utils/fs";
import { DATA_DIR } from "../config";
import path from "node:path";
import { log } from "../utils/log";

/**
 * npm run standards-review -- --episode N [--free-only]
 *
 * The Standards Officer's inspection against the Production Standards Charter
 * (docs/PRODUCTION-STANDARDS.md). --free-only runs only the deterministic
 * charter checks — safe under a spending freeze.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = Number(args.episode);
  if (!Number.isInteger(episode) || episode < 1) throw new Error("Pass --episode N");
  const freeOnly = args["free-only"] === true;
  const tracker = new CostTracker({ episode });
  const script = loadEpisodeScript(episode);
  let plan: RenderPlan | undefined;
  try {
    plan = loadRenderPlan(episode);
  } catch {
    /* not produced yet */
  }

  log.step(`Standards Officer — episode ${episode}${freeOnly ? " (free checks only)" : ""}`);
  const report: Record<string, unknown> = { episode, at: new Date().toISOString() };

  const charter = checkCharter(script, plan);
  report.charter = charter;
  for (const f of charter) {
    (f.severity === "critical" ? log.warn : log.info)(`[${f.rule}] ${f.detail}`);
  }
  if (charter.length === 0) log.ok("deterministic charter checks clean");

  if (!freeOnly) {
    const card = await reviewScorecard({
      script,
      bible: loadShowBible(),
      cast: loadCast(),
      tracker,
    });
    const verdict = judgeScorecard(card);
    report.scorecard = card;
    report.verdict = verdict;
    log.info(
      `scorecard overall ${verdict.overall.toFixed(1)} — ${verdict.pass ? "PASS" : "REJECT"}`,
    );
    for (const r of verdict.reasons) log.warn(`[threshold] ${r}`);
    for (const c of card.culturalConcerns) log.warn(`[cultural] ${c}`);
  }

  const file = path.join(DATA_DIR, "episodes", episodeId(episode), "standards-report.json");
  writeJson(file, report);
  const critical = charter.some((f) => f.severity === "critical");
  log.ok(`standards-report.json written${critical ? " — CRITICAL charter findings" : ""}`);
  if (critical) process.exit(1);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
