import { z } from "zod";
import { generateStructured } from "../ai/anthropic";
import { type Character, type EpisodeScript, type ShowBible } from "../ai/schemas";
import { type RenderPlan } from "../render/render-plan";
import { type CostTracker } from "../utils/cost";

/**
 * THE STANDARDS OFFICER — third standing employee (owner mandate 2026-07-29):
 * ensures the Production Standards Charter (docs/PRODUCTION-STANDARDS.md) is
 * ALWAYS met. Complements, never replaces, the existing reviewers:
 *
 *   Quality Director  → is it broken?
 *   Creative Director → is it good?
 *   Standards Officer → does it meet the charter, every time?
 *
 * Two layers:
 *  1. Deterministic charter checks (free, no API): runtime window, engagement
 *     ending rules, per-episode writing invariants, dialogue-rhythm spread.
 *  2. The 16-axis charter scorecard via Claude with the owner-adopted hard
 *     rejection thresholds.
 */

// ── Layer 1: deterministic charter checks (free) ────────────────────────────

export interface CharterFinding {
  rule: string;
  detail: string;
  severity: "minor" | "critical";
}

const RUNTIME_MIN_S = 35;
const RUNTIME_MAX_S = 60;
const FOLLOW_BAIT = /\b(like and follow|follow for more|smash that|hit follow|drop a follow)\b/i;

export function checkCharter(script: EpisodeScript, plan?: RenderPlan): CharterFinding[] {
  const findings: CharterFinding[] = [];

  if (plan) {
    const seconds = plan.durationFrames / plan.fps;
    if (seconds > RUNTIME_MAX_S + 5 || seconds < RUNTIME_MIN_S - 5) {
      findings.push({
        rule: "runtime",
        detail: `episode runs ${seconds.toFixed(1)}s — charter target ${RUNTIME_MIN_S}–${RUNTIME_MAX_S}s`,
        severity: seconds > 90 ? "critical" : "minor",
      });
    }
  }

  const endcard = script.scenes.find((s) => s.kind === "endcard");
  const endText = [
    ...(endcard?.lines.map((l) => l.text) ?? []),
    endcard?.visual ?? "",
    script.caption,
  ].join(" ");
  if (FOLLOW_BAIT.test(endText)) {
    findings.push({
      rule: "engagement-ending",
      detail: "generic follow-bait detected — endings must be a natural audience question",
      severity: "critical",
    });
  }
  const lastSpoken = [...script.scenes]
    .reverse()
    .flatMap((s) => [...s.lines].reverse())
    .find(Boolean);
  if (!/\?/.test(`${lastSpoken?.text ?? ""} ${endcard?.visual ?? ""} ${script.caption}`)) {
    findings.push({
      rule: "unresolved-ending",
      detail: "no audience question found at the end — every episode ends unresolved",
      severity: "minor",
    });
  }

  if (!script.scenes.some((s) => s.kind === "confessional")) {
    findings.push({
      rule: "confessional",
      detail: "no confessional/private-conversation scene",
      severity: "minor",
    });
  }

  // Reaction beat: at least one scene where someone present says nothing.
  const hasReactionBeat = script.scenes.some(
    (s) =>
      s.kind !== "endcard" &&
      s.characters.length > 0 &&
      s.characters.some((id) => !s.lines.some((l) => l.speaker === id)),
  );
  if (!hasReactionBeat) {
    findings.push({
      rule: "reaction-beat",
      detail: "no pure reaction beat (a visible character who doesn't speak)",
      severity: "minor",
    });
  }

  // Distinct rhythms: no single contestant dominates spoken contestant lines.
  const counts = new Map<string, number>();
  let contestantLines = 0;
  for (const s of script.scenes) {
    for (const l of s.lines) {
      if (l.speaker === "narrator") continue;
      contestantLines++;
      counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
    }
  }
  for (const [who, n] of counts) {
    if (contestantLines >= 6 && n / contestantLines > 0.45) {
      findings.push({
        rule: "voice-spread",
        detail: `${who} speaks ${Math.round((n / contestantLines) * 100)}% of contestant lines`,
        severity: "minor",
      });
    }
  }

  return findings;
}

// ── Layer 2: the 16-axis charter scorecard ──────────────────────────────────

const axis = (): z.ZodNumber => z.number().min(1).max(10);

export const scorecardSchema = z.object({
  scores: z.object({
    openingHook: axis(),
    plotClarity: axis(),
    characterConsistency: axis(),
    dialogue: axis(),
    humor: axis(),
    emotionalStakes: axis(),
    animationSmoothness: axis(),
    facialActing: axis(),
    voiceSyncFeel: axis(),
    cameraWork: axis(),
    soundDesign: axis(),
    subtitleReadability: axis(),
    visualContinuity: axis(),
    culturalTreatment: axis().describe(
      "playful cultural comedy without dehumanizing stereotypes; no country consistently inferior",
    ),
    cliffhanger: axis(),
    rewatchPotential: axis(),
  }),
  culturalConcerns: z.array(z.string()).max(5),
  requiredFixes: z.array(z.string()).max(6),
});
export type Scorecard = z.infer<typeof scorecardSchema>;

export interface ScorecardVerdict {
  pass: boolean;
  reasons: string[];
  overall: number;
}

/** Owner-adopted hard thresholds: overall ≥8, animation ≥8, character ≥9, cultural ≥9, hook ≥8. */
export function judgeScorecard(card: Scorecard): ScorecardVerdict {
  const s = card.scores;
  const values = Object.values(s);
  const overall = values.reduce((a, b) => a + b, 0) / values.length;
  const reasons: string[] = [];
  if (overall < 8) reasons.push(`overall ${overall.toFixed(1)} < 8`);
  if (s.animationSmoothness < 8) reasons.push(`animation ${s.animationSmoothness} < 8`);
  if (s.characterConsistency < 9)
    reasons.push(`character consistency ${s.characterConsistency} < 9`);
  if (s.culturalTreatment < 9) reasons.push(`cultural treatment ${s.culturalTreatment} < 9`);
  if (s.openingHook < 8) reasons.push(`hook ${s.openingHook} < 8`);
  return { pass: reasons.length === 0, reasons, overall };
}

export async function reviewScorecard(params: {
  script: EpisodeScript;
  bible: ShowBible;
  cast: Character[];
  tracker: CostTracker;
  frames?: { data: Buffer; mediaType: "image/png" | "image/jpeg" }[];
}): Promise<Scorecard> {
  const { script, bible, cast, tracker, frames } = params;
  const prompt = [
    `You are the Standards Officer of "${bible.title}". Score this episode 1-10 on every axis`,
    "of the Production Standards Charter. Judge the SCRIPT for story axes and the attached",
    "frames (if any) for visual axes; score visual axes 8 when no frames are attached.",
    "The charter's hard bars: overall ≥ 8, animation ≥ 8, character consistency ≥ 9, cultural",
    "treatment ≥ 9, hook ≥ 8 — score honestly against them; do not curve.",
    "Cultural treatment: playful lanes are food/fashion/music/sports/weather/nightlife/dating",
    "customs/tourism/rivalries; ANY dehumanizing stereotype, slur, or a country played as",
    "consistently inferior caps the axis at 3 and must be listed in culturalConcerns.",
    "",
    "Cast:",
    cast.map((c) => `${c.id} (${c.country}): ${c.personality}`).join("\n"),
    "",
    "SCRIPT:",
    JSON.stringify(script),
  ].join("\n");
  return generateStructured({
    item: `standards:scorecard:e${script.episode}`,
    prompt,
    schema: scorecardSchema,
    mock: () => ({
      scores: {
        openingHook: 8,
        plotClarity: 8,
        characterConsistency: 9,
        dialogue: 8,
        humor: 8,
        emotionalStakes: 8,
        animationSmoothness: 8,
        facialActing: 8,
        voiceSyncFeel: 8,
        cameraWork: 8,
        soundDesign: 8,
        subtitleReadability: 8,
        visualContinuity: 8,
        culturalTreatment: 9,
        cliffhanger: 8,
        rewatchPotential: 8,
      },
      culturalConcerns: [],
      requiredFixes: [],
    }),
    tracker,
    maxTokens: 8000,
    images: frames,
  });
}
