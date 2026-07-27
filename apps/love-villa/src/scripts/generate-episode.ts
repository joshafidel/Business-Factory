import { refuseIfLocked, requireApproved, setApproval } from "../approvals/approvals";
import { loadCast } from "../characters/character-manager";
import {
  checkBrandSafety,
  checkContinuity,
  checkStereotypeRisk,
  checkStructure,
} from "../episodes/continuity-checker";
import { generateEpisode } from "../episodes/episode-generator";
import {
  applyContinuityUpdate,
  loadSeasonArc,
  loadSeasonState,
  saveSeasonState,
} from "../show/season-state";
import { loadShowBible } from "../show/show-bible";
import { parseArgs, intArg } from "../utils/args";
import { CostTracker } from "../utils/cost";
import { episodeId } from "../utils/fs";
import { log } from "../utils/log";

/**
 * npm run generate-episode -- --episode 1
 *
 * Expands the season-arc beat into the full episode package: script (json+md),
 * shot list with image prompts, subtitle-ready dialogue, caption + hashtags,
 * and the continuity update. Applies the continuity update to season state
 * (story canon advances at scripting time) and ends at the "script" and
 * "visual-prompts" approval gates.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = intArg(args, "episode");
  const force = args.force === true;

  requireApproved("characters", undefined, force);
  requireApproved("season", undefined, force);
  refuseIfLocked("script", episode, force);

  const bible = loadShowBible();
  const cast = loadCast();
  const state = loadSeasonState();
  const arc = loadSeasonArc();
  const beat = arc.episodes.find((e) => e.episode === episode);
  if (!beat)
    throw new Error(`Season arc has no episode ${episode} (it has ${arc.episodes.length}).`);
  if (episode > state.currentEpisode + 1) {
    throw new Error(
      `Continuity: episode ${state.currentEpisode + 1} must be generated before episode ${episode}.`,
    );
  }

  const tracker = new CostTracker({ episode });
  log.step(`Generating episode ${episode}: "${beat.title}"`);
  const { script, shots, continuity } = await generateEpisode({
    beat,
    bible,
    cast,
    state,
    tracker,
  });

  log.step("Deterministic script checks");
  const issues = [
    ...checkContinuity(script, state, cast),
    ...checkBrandSafety(script, bible),
    ...checkStereotypeRisk(script, cast),
    ...checkStructure(script),
  ];
  for (const i of issues) {
    (i.severity === "error" ? log.error : log.warn)(`[${i.check}] ${i.message}`);
  }
  const errors = issues.filter((i) => i.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `${errors.length} blocking script issue(s) — fix the script or beat and regenerate.`,
    );
  }

  if (episode > state.currentEpisode) {
    saveSeasonState(applyContinuityUpdate(state, continuity));
    log.ok("season state advanced");
  }

  const dir = `data/episodes/${episodeId(episode)}`;
  setApproval("script", episode, "pending", `Review ${dir}/script.md`);
  setApproval("visual-prompts", episode, "pending", `Review ${dir}/shot-list.json`);
  log.ok(
    `${dir}/{script.json,script.md,shot-list.json,caption.txt,hashtags.txt,continuity-update.json}`,
  );
  log.info(
    `scenes: ${script.scenes.length} · shots: ${shots.length} · ledger: $${tracker.totalUsd.toFixed(2)}`,
  );
  log.info(`Next: npm run approve -- --stage script --episode ${episode}`);
  log.info(`      npm run approve -- --stage visual-prompts --episode ${episode}`);
  log.info(`Then: npm run produce-episode -- --episode ${episode}`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
