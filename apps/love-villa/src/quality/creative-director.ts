import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generateStructured } from "../ai/anthropic";
import { type Character, type EpisodeScript, type ShowBible } from "../ai/schemas";
import { DATA_DIR } from "../config";
import { assetAbs, type RenderPlan } from "../render/render-plan";
import { resolveFfmpeg } from "../render/render";
import { type CostTracker } from "../utils/cost";
import { episodeId } from "../utils/fs";

/**
 * THE CREATIVE DIRECTOR — the Business Factory's second standing reviewer
 * (owner mandate 2026-07-29), complementing the Quality Director:
 *
 *   Quality Director  → is it broken?   (defects, consistency, audio health)
 *   Creative Director → is it GOOD?     (entertainment, cinematography,
 *                                        backgrounds, motion restraint)
 *
 * It quality-checks the four owner criteria from docs/DIRECTIVES-V3.md:
 *  1. ENTERTAINMENT  — would a stranger watch the next episode? Reversals,
 *     status changes per scene, unpredictability. (Claude rubric)
 *  2. CINEMATOGRAPHY — no loop snap-backs, no unfinished camera moves.
 *     (deterministic, free: computed from the render plan)
 *  3. BACKGROUNDS    — environments composed for the action, not wallpaper.
 *     (Claude vision)
 *  4. MOTION RESTRAINT — subtle acting, not maximum-amplitude churn.
 *     (Claude vision over frame pairs sampled from each clip)
 *
 * Shared-toolbox note: the cinematography check is pipeline-agnostic — any
 * video lane (Zoo, Listing Factory) that loops clips can copy it.
 */

// ── 1. Entertainment (script) ───────────────────────────────────────────────

export const entertainmentReviewSchema = z.object({
  scores: z.object({
    wouldWatchNext: z.number().min(1).max(10).describe("cold-read: watch the next episode?"),
    unpredictability: z.number().min(1).max(10).describe("could a viewer call the twist by 0:15?"),
    reversal: z.number().min(1).max(10).describe("twist recontextualizes vs merely escalates"),
    statusChanges: z.number().min(1).max(10).describe("every scene changes who is winning"),
    characterCollision: z
      .number()
      .min(1)
      .max(10)
      .describe("comedy from character collision, not narrator explanation"),
  }),
  verdict: z.enum(["entertaining", "flat"]),
  whyAViewerWouldScrollAway: z.array(z.string()).max(4),
  pitchFixes: z.array(z.string()).max(4).describe("story-level fixes, not line edits"),
});
export type EntertainmentReview = z.infer<typeof entertainmentReviewSchema>;

export function entertainmentPasses(r: EntertainmentReview): boolean {
  const s = r.scores;
  return r.verdict === "entertaining" && s.wouldWatchNext >= 7 && s.reversal >= 7;
}

export async function reviewEntertainment(params: {
  script: EpisodeScript;
  bible: ShowBible;
  cast: Character[];
  tracker: CostTracker;
}): Promise<EntertainmentReview> {
  const { script, bible, cast, tracker } = params;
  const prompt = [
    `You are the Creative Director of "${bible.title}". You do NOT care about structure,`,
    "safety, or formatting — other reviewers own those. You care about ONE question: would a",
    "stranger scrolling TikTok watch this to the end and then want the next episode?",
    "Be brutal. 'Competent but predictable' is a FLAT verdict. A twist a viewer could guess by",
    "second 15 scores unpredictability ≤ 4. A twist that merely makes the known conflict bigger",
    "(instead of revealing the situation was never what we thought) scores reversal ≤ 4.",
    "",
    "Cast:",
    cast.map((c) => `${c.id}: ${c.personality} Secret: ${c.secret}`).join("\n"),
    "",
    "SCRIPT:",
    JSON.stringify(script),
  ].join("\n");
  return generateStructured({
    item: `creative:entertainment:e${script.episode}`,
    prompt,
    schema: entertainmentReviewSchema,
    mock: () => ({
      scores: {
        wouldWatchNext: 8,
        unpredictability: 8,
        reversal: 8,
        statusChanges: 8,
        characterCollision: 8,
      },
      verdict: "entertaining" as const,
      whyAViewerWouldScrollAway: [],
      pitchFixes: [],
    }),
    tracker,
    maxTokens: 8000,
  });
}

// ── 2. Cinematography (deterministic, free) ─────────────────────────────────

export interface CinematographyFinding {
  scene: number;
  issue: string;
  severity: "minor" | "critical";
}

/**
 * Camera-language checks computed straight from the render plan:
 *  - loop snap-back: clip shorter than its scene ⇒ the loop restart is a
 *    visible cut back to the opening framing (owner: "pans and then cuts to
 *    its original position"). >1.5 loops = critical.
 *  - unfinished pans on non-clip scenes (pan-* motion resets between scenes).
 */
export function reviewCinematography(plan: RenderPlan): CinematographyFinding[] {
  const findings: CinematographyFinding[] = [];
  for (const s of plan.scenes) {
    if (s.kind === "endcard") continue;
    if (s.clipFile && s.clipDurationFrames && s.clipDurationFrames > 0) {
      const loops = s.durationFrames / s.clipDurationFrames;
      if (loops > 1.5) {
        findings.push({
          scene: s.index,
          issue: `clip loops ${loops.toFixed(1)}× — visible snap back to opening framing on every restart`,
          severity: loops > 2 ? "critical" : "minor",
        });
      }
    } else if (s.motion === "pan-left" || s.motion === "pan-right") {
      findings.push({
        scene: s.index,
        issue: `unfinished ${s.motion} — camera resets at next scene`,
        severity: "minor",
      });
    }
  }
  return findings;
}

// ── 3+4. Backgrounds & motion restraint (Claude vision) ─────────────────────

export const lookReviewSchema = z.object({
  frames: z.array(
    z.object({
      index: z.number().int(),
      backgroundGrade: z
        .enum(["environment", "wallpaper"])
        .describe(
          "environment = composed for the action with unified lighting; wallpaper = flat backdrop with pasted subjects",
        ),
      motionAmplitude: z
        .enum(["subtle", "busy", "flailing"])
        .describe(
          "compare the paired frames: subtle = blinks/breath/one gesture; flailing = large limbs mid-swing, billowing cloth",
        ),
      notes: z.string(),
    }),
  ),
  overall: z.string(),
});
export type LookReview = z.infer<typeof lookReviewSchema>;

/** Sample first/mid frame pairs from each scene clip for the look review. */
export function sampleClipFramePairs(
  episode: number,
  plan: RenderPlan,
  outDir: string,
): { label: string; file: string }[] {
  const ffmpeg = resolveFfmpeg();
  const epId = episodeId(episode);
  const out: { label: string; file: string }[] = [];
  for (const s of plan.scenes) {
    if (!s.clipFile) continue;
    const abs = assetAbs(s.clipFile);
    if (!existsSync(abs)) continue;
    for (const [tag, ts] of [
      ["t0", "0.2"],
      ["t1", "2.5"],
    ] as const) {
      const file = path.join(outDir, `s${s.index}-${tag}.png`);
      try {
        execFileSync(ffmpeg, ["-y", "-v", "error", "-ss", ts, "-i", abs, "-frames:v", "1", file]);
        out.push({ label: `${epId}:s${s.index}:${tag}`, file });
      } catch {
        /* missing frame — skip */
      }
    }
  }
  return out;
}

export async function reviewLook(params: {
  episode: number;
  images: { label: string; file: string }[];
  tracker: CostTracker;
}): Promise<LookReview & { labels: string[] }> {
  const { episode, images, tracker } = params;
  const prompt = [
    `You are the Creative Director reviewing episode ${episode} of an animated reality short.`,
    `Attached are ${images.length} frames in consecutive PAIRS per scene (t0 ≈ clip start,`,
    "t1 ≈ 2.5s in), in order: " + images.map((i, n) => `${n}=${i.label}`).join(", "),
    "For each frame judge: (a) backgroundGrade — is the environment composed for this specific",
    "action with unified lighting and believable subject integration ('environment'), or is it",
    "a flat pretty backdrop with subjects pasted on top ('wallpaper')? (b) motionAmplitude —",
    "comparing each pair, how much did characters move? 'subtle' (blinks, breath, one gesture)",
    "is the goal; 'flailing' (large limbs mid-swing, everyone moving at once, billowing cloth)",
    "is an automatic fail per the owner's motion-restraint mandate.",
  ].join("\n");
  const result = await generateStructured({
    item: `creative:look:e${episode}`,
    prompt,
    schema: lookReviewSchema,
    mock: () => ({
      frames: images.map((_, index) => ({
        index,
        backgroundGrade: "environment" as const,
        motionAmplitude: "subtle" as const,
        notes: "mock",
      })),
      overall: "mock mode — no look review performed",
    }),
    tracker,
    maxTokens: 8000,
    images: images.map((i) => ({ data: readFileSync(i.file), mediaType: "image/png" as const })),
  });
  return { ...result, labels: images.map((i) => i.label) };
}

export function lookPasses(r: LookReview): boolean {
  const flailing = r.frames.filter((f) => f.motionAmplitude === "flailing").length;
  const wallpaper = r.frames.filter((f) => f.backgroundGrade === "wallpaper").length;
  return flailing === 0 && wallpaper <= Math.floor(r.frames.length * 0.25);
}

// ── Report location (kept beside the Quality Director's) ────────────────────

export function creativeReportFile(episode: number): string {
  return path.join(DATA_DIR, "episodes", episodeId(episode), "creative-report.json");
}
