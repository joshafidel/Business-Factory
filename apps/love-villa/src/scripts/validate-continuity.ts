import { loadCast } from "../characters/character-manager";
import { checkContinuity } from "../episodes/continuity-checker";
import { loadEpisodeScript } from "../episodes/episode-generator";
import { loadSeasonState } from "../show/season-state";
import { parseArgs, intArg } from "../utils/args";
import { log } from "../utils/log";

/**
 * npm run validate-continuity -- --episode 1
 *
 * Focused continuity pass: script vs season state (cast membership,
 * eliminations, arrivals). validate-episode runs this plus everything else.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = intArg(args, "episode");
  const script = loadEpisodeScript(episode);
  const issues = checkContinuity(script, loadSeasonState(), loadCast());
  for (const i of issues) {
    (i.severity === "error" ? log.error : log.warn)(`[${i.check}] ${i.message}`);
  }
  if (issues.some((i) => i.severity === "error")) process.exit(1);
  log.ok(`Episode ${episode} continuity clean (${issues.length} warning(s))`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
