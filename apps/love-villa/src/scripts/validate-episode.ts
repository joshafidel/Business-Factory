import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { type ValidationIssue, validationReportSchema } from "../ai/schemas";
import { loadCast } from "../characters/character-manager";
import { DATA_DIR, OUTPUT_DIR } from "../config";
import {
  checkBrandSafety,
  checkContinuity,
  checkStereotypeRisk,
  checkStructure,
  checkVoiceConsistency,
} from "../episodes/continuity-checker";
import { loadEpisodeScript } from "../episodes/episode-generator";
import { assetAbs, loadRenderPlan } from "../render/render-plan";
import { wrapWords } from "../render/plan-types";
import { loadSeasonState } from "../show/season-state";
import { loadShowBible } from "../show/show-bible";
import { parseArgs, intArg } from "../utils/args";
import { episodeId, readJsonIfExists, writeJson } from "../utils/fs";
import { log } from "../utils/log";
import {
  hasCriticalFindings,
  loadQualityReport,
  summarizeReport,
} from "../quality/quality-director";
import { wavDurationSeconds, wavPeak } from "../utils/wav";
import { type AssetManifest } from "./produce-episode";

/**
 * npm run validate-episode -- --episode 1
 *
 * Full episode QA: character/voice consistency, story continuity, missing
 * assets, subtitle overflow, video duration, audio clipping, duplicate
 * dialogue, hook strength, cliffhanger presence, brand-copying risk, and
 * harmful-stereotype risk. Writes validation-report.json.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = intArg(args, "episode");
  const epId = episodeId(episode);

  const bible = loadShowBible();
  const cast = loadCast();
  const state = loadSeasonState();
  const script = loadEpisodeScript(episode);

  const issues: ValidationIssue[] = [
    ...checkContinuity(script, state, cast),
    ...checkVoiceConsistency(cast),
    ...checkBrandSafety(script, bible),
    ...checkStereotypeRisk(script, cast),
    ...checkStructure(script),
  ];

  // Missing assets + audio checks (only meaningful after produce-episode).
  const manifest = readJsonIfExists<AssetManifest>(
    path.join(DATA_DIR, "episodes", epId, "assets.json"),
  );
  if (!manifest) {
    issues.push({
      check: "missing-assets",
      severity: "warning",
      message: "No asset manifest — run produce-episode to generate assets",
    });
  } else {
    const refs = [
      ...Object.values(manifest.characters),
      ...Object.values(manifest.locations),
      ...manifest.lines.map((l) => l.file),
      manifest.music,
    ].filter(Boolean);
    for (const rel of refs) {
      if (!existsSync(assetAbs(rel))) {
        issues.push({
          check: "missing-assets",
          severity: "error",
          message: `Missing asset: assets/${rel}`,
        });
      }
    }
    for (const f of manifest.failures) {
      issues.push({
        check: "missing-assets",
        severity: "warning",
        message: `Generation failure: ${f}`,
      });
    }
    // Audio clipping (WAV assets only — mp3 loudness is delegated to the TTS provider).
    for (const l of manifest.lines) {
      const abs = assetAbs(l.file);
      if (l.file.endsWith(".wav") && existsSync(abs)) {
        const wav = readFileSync(abs);
        const peak = wavPeak(wav);
        if (peak > 0.985) {
          issues.push({
            check: "audio-clipping",
            severity: "warning",
            message: `Line s${l.scene}-l${l.line} peaks at ${(peak * 100).toFixed(1)}% — risk of clipping`,
          });
        }
        const dur = wavDurationSeconds(wav);
        if (Math.abs(dur - l.seconds) > 0.5) {
          issues.push({
            check: "audio-timing",
            severity: "warning",
            message: `Line s${l.scene}-l${l.line}: manifest ${l.seconds.toFixed(2)}s vs file ${dur.toFixed(2)}s`,
          });
        }
      }
    }
  }

  // Subtitle overflow: every line must wrap into chunks of ≤2 rows without huge rows.
  for (const scene of script.scenes) {
    for (const line of scene.lines) {
      const rows = wrapWords(line.text.split(/\s+/).filter(Boolean));
      const widest = Math.max(...rows.map((r) => r.join(" ").length), 0);
      if (widest > 24) {
        issues.push({
          check: "subtitle-overflow",
          severity: "warning",
          message: `Scene ${scene.index + 1}: word run "${rows.find((r) => r.join(" ").length === widest)?.join(" ")}" is ${widest} chars wide`,
        });
      }
      if (rows.length > 6) {
        issues.push({
          check: "subtitle-overflow",
          severity: "warning",
          message: `Scene ${scene.index + 1}: line needs ${Math.ceil(rows.length / 2)} subtitle pages — consider splitting`,
        });
      }
    }
  }

  // Duration: prefer the real render plan; fall back to nothing.
  try {
    const plan = loadRenderPlan(episode);
    const seconds = plan.durationFrames / plan.fps;
    if (seconds < bible.format.durationSeconds.min || seconds > bible.format.durationSeconds.max) {
      issues.push({
        check: "video-duration",
        severity: seconds < 45 || seconds > 110 ? "error" : "warning",
        message: `Episode runs ${seconds.toFixed(1)}s (target ${bible.format.durationSeconds.min}–${bible.format.durationSeconds.max}s)`,
      });
    } else {
      issues.push({
        check: "video-duration",
        severity: "info",
        message: `Episode runs ${seconds.toFixed(1)}s — inside the 60–90s target`,
      });
    }
  } catch {
    issues.push({
      check: "video-duration",
      severity: "warning",
      message: "No render plan yet — duration unchecked (run produce-episode)",
    });
  }

  const finalFile = path.join(OUTPUT_DIR, "episodes", epId, "final.mp4");
  if (existsSync(finalFile)) {
    const mb = statSync(finalFile).size / 1024 / 1024;
    issues.push({
      check: "final-export",
      severity: "info",
      message: `final.mp4 present (${mb.toFixed(1)} MB)`,
    });
  }

  // Quality Director verdict is part of validation: critical findings fail it.
  const quality = loadQualityReport(episode);
  if (hasCriticalFindings(quality)) {
    issues.push({
      check: "quality-director",
      severity: "error",
      message: `critical quality findings — ${summarizeReport(quality)}`,
    });
  } else {
    issues.push({
      check: "quality-director",
      severity: "info",
      message: summarizeReport(quality),
    });
  }

  const errors = issues.filter((i) => i.severity === "error");
  const report = validationReportSchema.parse({ episode, passed: errors.length === 0, issues });
  writeJson(path.join(DATA_DIR, "episodes", epId, "validation-report.json"), report);

  log.step(`Validation — episode ${episode}`);
  for (const i of issues) {
    const fn = i.severity === "error" ? log.error : i.severity === "warning" ? log.warn : log.info;
    fn(`[${i.check}] ${i.message}`);
  }
  if (report.passed)
    log.ok(`PASSED with ${issues.filter((i) => i.severity === "warning").length} warning(s)`);
  else {
    log.error(`FAILED — ${errors.length} error(s)`);
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
