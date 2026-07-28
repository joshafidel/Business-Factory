import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { generateStructured } from "../ai/anthropic";
import { type Character, type EpisodeScript, type ShowBible } from "../ai/schemas";
import { DATA_DIR } from "../config";
import { assetAbs, assetRel } from "../render/render-plan";
import { resolveFfmpeg } from "../render/render";
import { type CostTracker } from "../utils/cost";
import { episodeId, readJsonIfExists, writeJson } from "../utils/fs";
import { log } from "../utils/log";

/**
 * THE QUALITY DIRECTOR — the pipeline's standing "employee" (owner directive,
 * 2026-07-28: "constantly evaluate yourself... add a new employee to ensure
 * these criteria are met").
 *
 * Reviews every episode on three axes and blocks work that misses the bar:
 *  - SCRIPT: rubric-scored by Claude (hook, one-premise comedic engine,
 *    causal escalation, character voice, comedic pacing, ending). Below the
 *    bar → the episode generator revises with the critique and retries.
 *  - AUDIO: every voice line checked locally (duration sanity, loudness
 *    window, clipping) so a broken take never reaches the final mix.
 *  - VISUALS: stills/frames reviewed by Claude vision for AI defects,
 *    style/design consistency across cuts, and nationality-obvious wardrobe.
 *
 * Findings land in data/episodes/<ep>/quality-report.json; validate-episode
 * refuses to pass an episode whose report has critical findings.
 */

export const SCRIPT_PASS_BAR = 7;

// ── Script review ───────────────────────────────────────────────────────────

export const scriptReviewSchema = z.object({
  scores: z.object({
    hook: z.number().min(1).max(10),
    comedicEngine: z
      .number()
      .min(1)
      .max(10)
      .describe("ONE premise mined for every joke; no non-sequitur concepts"),
    causalEscalation: z.number().min(1).max(10),
    characterVoice: z.number().min(1).max(10),
    comedicPacing: z.number().min(1).max(10).describe("setup-beat-punchline rhythm, room to land"),
    ending: z.number().min(1).max(10),
  }),
  verdict: z.enum(["pass", "revise"]),
  topProblems: z.array(z.string()).max(5),
  concreteFixes: z.array(z.string()).max(6),
});
export type ScriptReview = z.infer<typeof scriptReviewSchema>;

export function scriptReviewPasses(review: ScriptReview): boolean {
  const s = review.scores;
  const all = [
    s.hook,
    s.comedicEngine,
    s.causalEscalation,
    s.characterVoice,
    s.comedicPacing,
    s.ending,
  ];
  const avg = all.reduce((a, b) => a + b, 0) / all.length;
  return (
    review.verdict === "pass" &&
    all.every((x) => x >= SCRIPT_PASS_BAR - 1) &&
    avg >= SCRIPT_PASS_BAR
  );
}

export async function reviewScript(params: {
  script: EpisodeScript;
  bible: ShowBible;
  cast: Character[];
  tracker: CostTracker;
}): Promise<ScriptReview> {
  const { script, bible, cast, tracker } = params;
  const prompt = [
    `You are the ruthless Quality Director of "${bible.title}" — a viral narrator-led animated`,
    "reality short. Grade this episode script 1-10 per rubric axis. Be genuinely harsh: a 7 is",
    "'shippable', an 8+ is 'this would trend'. Scripts fail for: weak hook, jokes that abandon",
    "the episode's single comic premise (non-sequitur concepts like a spreadsheet joke in a food",
    "war that never set it up), escalation that isn't caused by the previous beat, characters",
    "who all sound the same, machine-gun pacing with no room for jokes to land, flat endings.",
    "",
    "Cast (for voice distinctness):",
    cast.map((c) => `${c.id}: ${c.personality}`).join("\n"),
    "",
    "SCRIPT:",
    JSON.stringify(script),
    "",
    `Verdict "pass" only if every axis would score ≥ ${SCRIPT_PASS_BAR - 1} and the average ≥ ${SCRIPT_PASS_BAR}.`,
    "concreteFixes must be surgical and actionable (name the scene/line and what to change).",
  ].join("\n");
  return generateStructured({
    item: `quality:script-review:e${script.episode}`,
    prompt,
    schema: scriptReviewSchema,
    mock: () => ({
      scores: {
        hook: 8,
        comedicEngine: 8,
        causalEscalation: 8,
        characterVoice: 8,
        comedicPacing: 8,
        ending: 8,
      },
      verdict: "pass" as const,
      topProblems: [],
      concreteFixes: [],
    }),
    tracker,
    maxTokens: 3000,
  });
}

// ── Audio review (local, free) ──────────────────────────────────────────────

export interface AudioFinding {
  file: string;
  issue: string;
  severity: "minor" | "critical";
}

export function reviewAudio(episode: number): AudioFinding[] {
  const epId = episodeId(episode);
  const dir = assetAbs(assetRel("episodes", epId, "audio"));
  if (!existsSync(dir)) return [{ file: dir, issue: "no audio directory", severity: "critical" }];
  const findings: AudioFinding[] = [];
  const ffmpeg = resolveFfmpeg();
  for (const f of readdirSync(dir).filter((f) => /\.(mp3|wav)$/.test(f))) {
    const abs = path.join(dir, f);
    // volumedetect reports on stderr with exit 0 — capture both streams.
    let out: string;
    try {
      out = execFileSync("sh", [
        "-c",
        `"${ffmpeg}" -i "${abs}" -af volumedetect -f null - 2>&1`,
      ]).toString();
    } catch (err) {
      out = String((err as { stdout?: Buffer }).stdout ?? "");
    }
    const mean = /mean_volume:\s*(-?[\d.]+) dB/.exec(out)?.[1];
    const max = /max_volume:\s*(-?[\d.]+) dB/.exec(out)?.[1];
    const dur = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(out);
    const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : NaN;
    if (!Number.isFinite(seconds) || seconds < 0.4) {
      findings.push({ file: f, issue: `suspiciously short (${seconds}s)`, severity: "critical" });
    } else if (seconds > 16) {
      findings.push({ file: f, issue: `too long (${seconds.toFixed(1)}s)`, severity: "minor" });
    }
    if (mean != null) {
      const m = Number(mean);
      if (m < -30)
        findings.push({ file: f, issue: `too quiet (mean ${m} dB)`, severity: "critical" });
      else if (m > -8)
        findings.push({ file: f, issue: `too hot (mean ${m} dB)`, severity: "minor" });
    }
    if (max != null && Number(max) >= -0.1) {
      findings.push({ file: f, issue: `clipping (max ${max} dB)`, severity: "minor" });
    }
  }
  return findings;
}

// ── Visual review (Claude vision) ───────────────────────────────────────────

export const visualReviewSchema = z.object({
  images: z.array(
    z.object({
      index: z.number().int().describe("0-based index of the attached image"),
      aiDefects: z
        .array(z.string())
        .describe("extra/missing limbs, warped hands/faces, garbled text, vanished props"),
      styleConsistent: z.boolean().describe("matches the glossy candy-bright house style"),
      nationalityObvious: z
        .boolean()
        .describe(
          "characters' flag-colored national wardrobe reads at a glance (true if no characters visible)",
        ),
      severity: z.enum(["ok", "minor", "critical"]),
      notes: z.string(),
    }),
  ),
  overallNotes: z.string(),
});
export type VisualReview = z.infer<typeof visualReviewSchema>;

export async function reviewVisuals(params: {
  episode: number;
  images: { label: string; file: string }[];
  tracker: CostTracker;
}): Promise<VisualReview & { labels: string[] }> {
  const { episode, images, tracker } = params;
  const buffers = images.map((i) => ({
    data: readFileSync(i.file),
    mediaType: "image/png" as const,
  }));
  const prompt = [
    `You are the Quality Director of an animated reality short. The ${images.length} attached`,
    `images are frames/stills from episode ${episode}, in order: ${images.map((i, n) => `${n}=${i.label}`).join(", ")}.`,
    "For EACH image report: AI-generation defects (extra/missing/warped limbs or hands, melted",
    "faces, garbled text, impossible geometry, vanished props), whether it matches the glossy",
    "candy-bright 3D house style (consistent color grading and character proportions across",
    "images), and whether visible characters' national identity is instantly obvious from",
    "flag-colored wardrobe (US stars-and-stripes, Union Jack, Italian tricolore, etc.).",
    "severity: 'critical' = a viewer would notice something is wrong or 'looks AI' — be strict;",
    "'minor' = imperfect but shippable; 'ok' = clean.",
  ].join("\n");
  const result = await generateStructured({
    item: `quality:visual-review:e${episode}`,
    prompt,
    schema: visualReviewSchema,
    mock: () => ({
      images: images.map((_, index) => ({
        index,
        aiDefects: [],
        styleConsistent: true,
        nationalityObvious: true,
        severity: "ok" as const,
        notes: "mock review",
      })),
      overallNotes: "mock mode — no visual review performed",
    }),
    tracker,
    maxTokens: 3500,
    images: buffers,
  });
  return { ...result, labels: images.map((i) => i.label) };
}

// ── Report ──────────────────────────────────────────────────────────────────

export interface QualityReport {
  episode: number;
  updatedAt: string;
  script?: ScriptReview & { iterations: number };
  audio?: { findings: AudioFinding[]; checkedAt: string };
  visuals?: (VisualReview & { labels: string[]; checkedAt: string })[];
}

export function qualityReportFile(episode: number): string {
  return path.join(DATA_DIR, "episodes", episodeId(episode), "quality-report.json");
}

export function loadQualityReport(episode: number): QualityReport {
  return (
    readJsonIfExists<QualityReport>(qualityReportFile(episode)) ?? {
      episode,
      updatedAt: new Date().toISOString(),
    }
  );
}

export function saveQualityReport(report: QualityReport): void {
  report.updatedAt = new Date().toISOString();
  writeJson(qualityReportFile(report.episode), report);
}

/** True if any recorded finding is critical (blocks validate-episode). */
export function hasCriticalFindings(report: QualityReport): boolean {
  if (report.audio?.findings.some((f) => f.severity === "critical")) return true;
  if (report.visuals?.some((v) => v.images.some((i) => i.severity === "critical"))) return true;
  if (report.script && !scriptReviewPasses(report.script)) return true;
  return false;
}

export function summarizeReport(report: QualityReport): string {
  const parts: string[] = [];
  if (report.script) {
    const s = report.script.scores;
    parts.push(
      `script ${report.script.verdict} (hook ${s.hook}, engine ${s.comedicEngine}, escalation ` +
        `${s.causalEscalation}, voice ${s.characterVoice}, pacing ${s.comedicPacing}, ending ${s.ending}; ` +
        `${report.script.iterations} draft(s))`,
    );
  }
  if (report.audio) {
    const crit = report.audio.findings.filter((f) => f.severity === "critical").length;
    parts.push(`audio: ${report.audio.findings.length} finding(s), ${crit} critical`);
  }
  for (const v of report.visuals ?? []) {
    const crit = v.images.filter((i) => i.severity === "critical").length;
    parts.push(`visuals(${v.labels.length} imgs): ${crit} critical`);
  }
  return parts.join(" · ") || "no reviews recorded yet";
}

export function logFindings(report: QualityReport): void {
  if (report.audio) {
    for (const f of report.audio.findings) {
      (f.severity === "critical" ? log.warn : log.info)(`[audio] ${f.file}: ${f.issue}`);
    }
  }
  for (const v of report.visuals ?? []) {
    for (const img of v.images) {
      if (img.severity !== "ok") {
        const label = v.labels[img.index] ?? `img${img.index}`;
        (img.severity === "critical" ? log.warn : log.info)(
          `[visual] ${label}: ${img.aiDefects.join("; ") || img.notes}`,
        );
      }
    }
  }
}
