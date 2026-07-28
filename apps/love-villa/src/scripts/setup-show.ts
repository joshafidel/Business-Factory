import path from "node:path";
import { generateStructured } from "../ai/anthropic";
import { FULL_CAST } from "../ai/mock-content/cast";
import { SHOW_BIBLE } from "../ai/mock-content/show-bible";
import { refineCastPrompt } from "../ai/prompts";
import { castSchema, showBibleSchema } from "../ai/schemas";
import { getApproval, refuseIfLocked, setApproval } from "../approvals/approvals";
import { parseArgs } from "../utils/args";
import { saveCast } from "../characters/character-manager";
import { ASSETS_DIR, describeProviders, loadConfig } from "../config";
import { characterImage, locationImage } from "../providers/images";
import { findExistingAsset } from "../render/render-plan";
import { CostTracker } from "../utils/cost";
import { ensureDir, writeText } from "../utils/fs";
import { log } from "../utils/log";
import { synthSfx, type SfxKind } from "../utils/wav";
import { initialSeasonState, saveSeasonState } from "../show/season-state";
import { saveShowBible } from "../show/show-bible";
import { existsSync, writeFileSync } from "node:fs";

/**
 * npm run setup-show
 *
 * Creates the show bible, villa environment references, the full cast with
 * locked visual/voice identities, character + location reference art, shared
 * SFX, and the initial season state. Ends at the "characters" approval gate.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  log.step("Love Villa: Nations — show setup");
  console.log(describeProviders());
  refuseIfLocked("characters", undefined, args.force === true);
  const tracker = new CostTracker({});
  const env = loadConfig();

  log.step("Show bible");
  // The bible is authored (brand/safety rules are policy, not generation).
  const bible = showBibleSchema.parse(SHOW_BIBLE);
  saveShowBible(bible);
  log.ok("data/show-state/show-bible.json + SHOW-BIBLE.md");

  log.step("Cast (8 founders + 1 planned arrival)");
  const cast = await generateStructured({
    item: "cast-refinement",
    prompt: refineCastPrompt(bible, FULL_CAST),
    schema: castSchema,
    mock: () => FULL_CAST,
    tracker,
  });
  saveCast(cast);
  log.ok(`data/characters/cast.json (${cast.length} characters) + CAST.md`);

  // Reference art is idempotent: existing files are kept (delete a PNG to
  // force its regeneration) unless REUSE_EXISTING_ASSETS=false.
  log.step("Character reference art");
  for (const c of cast) {
    if (env.REUSE_EXISTING_ASSETS && findExistingAsset(`characters/${c.id}`, ["png", "svg"])) {
      log.info(`${c.fullName} — existing art kept`);
      continue;
    }
    const img = await characterImage(c, tracker, env.IMAGE_QUALITY);
    const file = path.join(ASSETS_DIR, "characters", `${c.id}.${img.ext}`);
    ensureDir(path.dirname(file));
    writeFileSync(file, img.data);
    log.info(`${c.fullName} → assets/characters/${c.id}.${img.ext}`);
  }

  log.step("Villa location references");
  for (const loc of bible.villa.locations) {
    if (env.REUSE_EXISTING_ASSETS && findExistingAsset(`locations/${loc.id}`, ["png", "svg"])) {
      log.info(`${loc.name} — existing art kept`);
      continue;
    }
    const img = await locationImage(loc, tracker, env.IMAGE_QUALITY);
    const file = path.join(ASSETS_DIR, "locations", `${loc.id}.${img.ext}`);
    ensureDir(path.dirname(file));
    writeFileSync(file, img.data);
    log.info(`${loc.name} → assets/locations/${loc.id}.${img.ext}`);
  }

  log.step("Shared SFX bank (synthesized, royalty-free)");
  const kinds: SfxKind[] = ["whoosh", "ding", "sting", "pop", "heartbeat"];
  ensureDir(path.join(ASSETS_DIR, "sfx"));
  for (const kind of kinds) {
    writeFileSync(path.join(ASSETS_DIR, "sfx", `${kind}.wav`), synthSfx(kind));
  }
  log.ok("assets/sfx/*.wav");

  log.step("Initial season state");
  const stateFile = path.join(ASSETS_DIR, "..", "data", "show-state", "season-state.json");
  if (existsSync(stateFile)) {
    log.info("season-state.json already exists — keeping it (story canon is never reset by setup)");
  } else {
    saveSeasonState(initialSeasonState(cast));
    log.ok("data/show-state/season-state.json");
  }

  // Voice map template for live TTS.
  writeText(
    path.join(ASSETS_DIR, "..", "data", "voice-map.example.json"),
    JSON.stringify(Object.fromEntries(cast.map((c) => [c.id, "<elevenlabs-voice-id>"])), null, 2),
  );

  if (getApproval("characters")?.status !== "approved") {
    setApproval("characters", undefined, "pending", "Review data/characters/CAST.md");
  }
  log.step("Next steps");
  log.info("1. Review data/characters/CAST.md and data/show-state/SHOW-BIBLE.md");
  log.info("2. Approve the cast:   npm run approve -- --stage characters");
  log.info("3. Plan the season:    npm run generate-season -- --episodes 10");
  log.ok(`Setup complete (ledger total: $${tracker.totalUsd.toFixed(2)})`);
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
