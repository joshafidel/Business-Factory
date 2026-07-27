import path from "node:path";
import { generateStructured } from "../ai/anthropic";
import { SEASON_ARC } from "../ai/mock-content/season-arc";
import { seasonPrompt } from "../ai/prompts";
import { seasonArcSchema } from "../ai/schemas";
import { refuseIfLocked, requireApproved, setApproval } from "../approvals/approvals";
import { loadCast } from "../characters/character-manager";
import { DATA_DIR, loadConfig } from "../config";
import { saveSeasonArc } from "../show/season-state";
import { loadShowBible } from "../show/show-bible";
import { parseArgs, intArg } from "../utils/args";
import { CostTracker } from "../utils/cost";
import { writeText } from "../utils/fs";
import { log } from "../utils/log";

/**
 * npm run generate-season -- --episodes 10
 *
 * Plans a connected season arc (continuity-aware beats, hooks, twists,
 * engagement, signature lines). Ends at the "season" approval gate.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episodes = intArg(args, "episodes", 10);
  const force = args.force === true;

  requireApproved("characters", undefined, force);
  refuseIfLocked("season", undefined, force);

  const bible = loadShowBible();
  const cast = loadCast();
  const tracker = new CostTracker({});

  log.step(`Planning a ${episodes}-episode season arc`);
  if (!loadConfig().ANTHROPIC_API_KEY && episodes > SEASON_ARC.episodes.length) {
    throw new Error(
      `Mock mode ships a hand-authored ${SEASON_ARC.episodes.length}-episode arc. ` +
        `Request ≤${SEASON_ARC.episodes.length} episodes, or set ANTHROPIC_API_KEY for longer seasons.`,
    );
  }
  const arc = await generateStructured({
    item: `season-arc-${episodes}ep`,
    prompt: seasonPrompt(bible, cast, episodes),
    schema: seasonArcSchema,
    mock: () => ({ ...SEASON_ARC, episodes: SEASON_ARC.episodes.slice(0, episodes) }),
    tracker,
  });
  saveSeasonArc(arc);

  const md = [
    `# Season ${arc.season} — ${bible.title}`,
    "",
    `**Theme.** ${arc.theme}`,
    "",
    arc.arcSummary,
    "",
    'Review this file for the "season" approval checkpoint.',
    "",
    ...arc.episodes.map(
      (e) =>
        `## Episode ${e.episode}: ${e.title}\n\n` +
        `- **Hook:** ${e.hook}\n- **Twist:** ${e.twist}\n- **Engagement:** ${e.engagement.text}\n` +
        `- **Focus:** ${e.focusCharacters.join(", ")}\n- **Connects:** ${e.connectionToPrevious}\n\n${e.summary}\n`,
    ),
  ].join("\n");
  writeText(path.join(DATA_DIR, "show-state", "SEASON.md"), md);

  setApproval("season", undefined, "pending", "Review data/show-state/SEASON.md");
  log.ok(`data/show-state/season-arc.json (${arc.episodes.length} episodes) + SEASON.md`);
  log.info("Next: npm run approve -- --stage season");
  log.info("Then: npm run generate-episode -- --episode 1");
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
