import { isNarrator } from "../ai/narrator";
import {
  type Character,
  type EpisodeScript,
  type SeasonState,
  type ShowBible,
  type ValidationIssue,
} from "../ai/schemas";

/**
 * Deterministic script checks: continuity, cast/voice consistency, brand
 * safety, stereotype risk, structure. Used by generate-episode (fail fast)
 * and validate-episode (full report).
 */

export function checkContinuity(
  script: EpisodeScript,
  state: SeasonState,
  cast: Character[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const known = new Set(cast.map((c) => c.id));
  const inVilla = new Set(state.cast);
  // Characters arriving THIS episode are allowed to appear from their arrival scene.
  const arrivingThisEpisode = new Set(
    script.scenes.filter((s) => s.kind === "arrival").flatMap((s) => s.characters),
  );

  for (const scene of script.scenes) {
    for (const id of [...scene.characters, ...scene.lines.map((l) => l.speaker)]) {
      if (isNarrator(id)) {
        if (scene.characters.includes(id)) {
          issues.push({
            check: "character-consistency",
            severity: "warning",
            message: `Scene ${scene.index + 1}: the narrator is off-screen and should not be listed in characters`,
          });
        }
        continue;
      }
      if (!known.has(id)) {
        issues.push({
          check: "character-consistency",
          severity: "error",
          message: `Scene ${scene.index + 1} uses unknown character "${id}"`,
        });
      } else if (state.eliminated.includes(id)) {
        issues.push({
          check: "story-continuity",
          severity: "error",
          message: `Scene ${scene.index + 1} uses eliminated character "${id}"`,
        });
      } else if (!inVilla.has(id) && !arrivingThisEpisode.has(id)) {
        issues.push({
          check: "story-continuity",
          severity: "error",
          message: `Scene ${scene.index + 1} uses "${id}" who is not in the villa yet (and doesn't arrive this episode)`,
        });
      }
    }
    for (const line of scene.lines) {
      if (isNarrator(line.speaker)) continue;
      if (!scene.characters.includes(line.speaker) && scene.kind !== "endcard") {
        issues.push({
          check: "character-consistency",
          severity: "warning",
          message: `Scene ${scene.index + 1}: speaker "${line.speaker}" is not listed in the scene's characters`,
        });
      }
    }
  }
  return issues;
}

export function checkVoiceConsistency(cast: Character[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const c of cast) {
    if (c.voice.provider !== "elevenlabs") {
      issues.push({
        check: "voice-consistency",
        severity: "error",
        message: `${c.id}: unexpected voice provider "${c.voice.provider}"`,
      });
    }
  }
  const seeds = new Map<number, string>();
  for (const c of cast) {
    const prev = seeds.get(c.imageSeed);
    if (prev) {
      issues.push({
        check: "character-consistency",
        severity: "error",
        message: `${c.id} and ${prev} share image seed ${c.imageSeed} — designs would collide`,
      });
    }
    seeds.set(c.imageSeed, c.id);
  }
  return issues;
}

export function checkBrandSafety(script: EpisodeScript, bible: ShowBible): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const text = JSON.stringify(script).toLowerCase();
  for (const phrase of bible.bannedPhrases) {
    if (text.includes(phrase.toLowerCase())) {
      issues.push({
        check: "brand-copy-risk",
        severity: "error",
        message: `Banned phrase found in script: "${phrase}" (protected element of another show)`,
      });
    }
  }
  return issues;
}

/**
 * Heuristic stereotype-risk screen: flags dehumanizing framings near
 * nationality words. (Live mode adds an LLM review on top; this list is a
 * floor, not a ceiling.)
 */
const DEHUMANIZING = [
  "stupid",
  "idiot nation",
  "criminal",
  "dirty",
  "filthy",
  "savage",
  "inferior",
  "untrustworthy",
  "lazy race",
  "all of them are",
];

export function checkStereotypeRisk(script: EpisodeScript, cast: Character[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const countries = cast.map((c) => c.country.toLowerCase());
  for (const scene of script.scenes) {
    for (const line of scene.lines) {
      const lower = line.text.toLowerCase();
      for (const term of DEHUMANIZING) {
        if (lower.includes(term)) {
          const nearCountry = countries.some((c) => lower.includes(c.split(" ")[0] ?? c));
          issues.push({
            check: "stereotype-risk",
            severity: nearCountry ? "error" : "warning",
            message: `Scene ${scene.index + 1}: "${line.text}" contains "${term}"${nearCountry ? " near a nationality reference" : ""}`,
          });
        }
      }
    }
  }
  // Equal-treatment sanity check: no single character dominates all dialogue.
  const counts = new Map<string, number>();
  for (const scene of script.scenes)
    for (const line of scene.lines) {
      if (isNarrator(line.speaker)) continue; // narrator-led format by design
      counts.set(line.speaker, (counts.get(line.speaker) ?? 0) + 1);
    }
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  for (const [speaker, n] of counts) {
    if (total >= 10 && n / total > 0.5) {
      issues.push({
        check: "stereotype-risk",
        severity: "warning",
        message: `${speaker} speaks ${n}/${total} lines — episode leans too hard on one nationality`,
      });
    }
  }
  return issues;
}

export function checkStructure(script: EpisodeScript): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const slots = new Set(script.scenes.map((s) => s.slot));
  for (const slot of ["hook", "setup", "escalation", "twist", "engagement"] as const) {
    if (!slots.has(slot)) {
      // A cold-open hook may absorb the setup beat (runtime surgery cuts
      // setup first to protect the charter's runtime target); every other
      // beat is structural and its absence breaks the episode.
      const severity = slot === "setup" ? "warning" : "error";
      issues.push({ check: "structure", severity, message: `Missing "${slot}" beat` });
    }
  }
  if (!script.scenes.some((s) => s.kind === "confessional")) {
    issues.push({ check: "structure", severity: "error", message: "No confessional scene" });
  }
  const first = script.scenes[0];
  if (first) {
    const hookWords = (first.lines[0]?.text ?? "").split(/\s+/).length;
    if (first.slot !== "hook") {
      issues.push({
        check: "hook-strength",
        severity: "error",
        message: "Episode must open on the hook",
      });
    } else if (first.lines.length === 0 || hookWords > 14) {
      issues.push({
        check: "hook-strength",
        severity: "warning",
        message: "Hook should open with one short, punchy spoken line (≤14 words)",
      });
    }
  }
  const last = script.scenes[script.scenes.length - 1];
  if (last && last.slot !== "engagement") {
    issues.push({
      check: "cliffhanger-presence",
      severity: "error",
      message: "Episode must end on an engagement beat (cliffhanger/vote/question/preview)",
    });
  }
  // Dialogue rules
  const seen = new Map<string, number>();
  for (const scene of script.scenes) {
    for (const line of scene.lines) {
      const words = line.text.split(/\s+/).length;
      if (words > 18) {
        issues.push({
          check: "dialogue",
          severity: "warning",
          message: `Scene ${scene.index + 1}: line over 18 words ("${line.text.slice(0, 40)}…")`,
        });
      }
      const key = `${line.speaker}|${line.text.toLowerCase()}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
  }
  for (const [key, n] of seen) {
    if (n > 1) {
      issues.push({
        check: "duplicate-dialogue",
        severity: "warning",
        message: `Duplicated line (${n}x): ${key.split("|")[1]}`,
      });
    }
  }
  return issues;
}
