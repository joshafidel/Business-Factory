import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";

/**
 * Automated visual QA (Animation 2.0): every generated still and motion clip
 * is inspected by a vision model against a defect checklist BEFORE it can
 * ship. This is the guard against the classic AI-generation tells — extra
 * limbs/trunks, props that pop in and out of existence, melting geometry —
 * that make a video read as machine-made.
 *
 * The checklist prompt lives here (VISUAL_QA_PROMPT) and is documented in
 * docs/animation/VISUAL-QA.md. gpt-4o at ~$0.01 per inspection.
 */
const OPENAI_BASE = "https://api.openai.com/v1";
const QA_MODEL = "gpt-4o";

const log = createLogger("vision-qa");

export const VISUAL_QA_PROMPT = `You are a ruthless senior animation QA reviewer for a children's studio. Your job is to catch every visual defect that would reveal this image/clip as AI-generated. Toddler-cartoon stylization (big eyes, pastel colors, simplified shapes) is the INTENDED style — never flag it. Flag REAL defects only.

CHECK EVERY FRAME FOR:
1. ANATOMY — each animal has exactly the right body parts for its species: ONE trunk per elephant, ONE tail, TWO ears, TWO eyes, FOUR legs (or two arms + two legs when standing cartoon-style). No extra, missing, fused, or detached limbs/trunks/tails. No hands growing from wrong places. No second face. Mouths and eyes well-formed.
2. OBJECT PERMANENCE (multi-frame clips) — every prop visible in one frame must exist in the others unless it plausibly moved off-screen: buckets, brushes, toys, food must NOT vanish, appear from nowhere, teleport, or morph into different objects. Characters must not appear/disappear mid-clip.
3. GEOMETRY & PHYSICS — no melting or smearing shapes, no body parts passing through objects or each other, no floating detached objects, no impossible bends, water/bubbles behave plausibly for a cartoon.
4. IDENTITY — the same character keeps identical colors, proportions and design in every frame (no color shifts, no turning into a different animal).
5. RENDERING ARTIFACTS — no garbled text or pseudo-letters anywhere (signs, arches, labels), no watermarks, no ghosting/double exposure, no random noise patches, no severed cropping of a main character's face.
6. COMPOSITION — main characters fully in frame and readable; no unintended horror-adjacent look (dead eyes, unsettling grins).

Respond ONLY with JSON:
{
  "score": <0-100 overall visual quality, 100 = flawless human-studio quality>,
  "criticalDefects": ["<defect a viewer would notice, e.g. 'elephant has a second trunk growing from its cheek in frames 2-4'>"],
  "minorIssues": ["<small imperfections that don't break believability>"]
}
A defect belongs in criticalDefects if a parent watching would think "that's wrong/AI-made". Empty criticalDefects means the asset is publishable. Be strict: a missed defect ships to YouTube; a false positive only costs one cheap regeneration.`;

export interface VisualQaResult {
  score: number;
  pass: boolean;
  criticalDefects: string[];
  minorIssues: string[];
  costMicroUsd: bigint;
}

export function visionQaConfigured(): boolean {
  return Boolean(loadEnv().OPENAI_API_KEY);
}

async function proxyDispatcher(): Promise<unknown> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return undefined;
  const { ProxyAgent } = await import("undici");
  return new ProxyAgent(proxy);
}

/** Parse the model's JSON verdict; tolerate stray formatting. */
export function parseQaVerdict(
  text: string,
): { score: number; criticalDefects: string[]; minorIssues: string[] } | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    const parsed = JSON.parse(text.slice(start, end + 1)) as {
      score?: unknown;
      criticalDefects?: unknown;
      minorIssues?: unknown;
    };
    const strings = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 10) : [];
    const score = typeof parsed.score === "number" ? Math.max(0, Math.min(100, parsed.score)) : 0;
    return { score, criticalDefects: strings(parsed.criticalDefects), minorIssues: strings(parsed.minorIssues) };
  } catch {
    return null;
  }
}

/**
 * Inspect one asset (a still, or sampled frames of a clip). Frames should be
 * pre-downscaled (~512px wide) PNGs/JPEGs — QA needs composition, not pixels.
 *
 * Fail-open by design: if the QA service itself errors, the asset passes with
 * score -1 recorded, so a vision-API outage can't wedge the video pipeline.
 */
export async function critiqueFrames(params: {
  frames: Buffer[];
  kind: "still" | "clip";
  sceneDescription: string;
  characters?: string[];
  minScore?: number;
}): Promise<VisualQaResult> {
  const env = loadEnv();
  const minScore = params.minScore ?? 70;
  if (!env.OPENAI_API_KEY || params.frames.length === 0) {
    return { score: -1, pass: true, criticalDefects: [], minorIssues: [], costMicroUsd: 0n };
  }
  const context =
    `${params.kind === "clip" ? `These ${params.frames.length} frames are sampled in order from ONE ~5s animation clip — also check consistency BETWEEN frames.` : "This is a single still image."}` +
    ` Intended scene: ${params.sceneDescription.slice(0, 400)}.` +
    (params.characters?.length ? ` Expected characters: ${params.characters.join(", ")}.` : "");
  try {
    const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: QA_MODEL,
        max_tokens: 500,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: VISUAL_QA_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: context },
              ...params.frames.map((f) => ({
                type: "image_url",
                image_url: { url: `data:image/png;base64,${f.toString("base64")}`, detail: "high" },
              })),
            ],
          },
        ],
      }),
      ...(process.env.HTTPS_PROXY ? { dispatcher: await proxyDispatcher() } : {}),
    } as RequestInit);
    if (!res.ok) {
      log.warn({ status: res.status }, "visual QA request failed; passing open");
      return { score: -1, pass: true, criticalDefects: [], minorIssues: [], costMicroUsd: 0n };
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const verdict = parseQaVerdict(data.choices?.[0]?.message?.content ?? "");
    // gpt-4o: $2.5/M input, $10/M output.
    const cost = BigInt(
      Math.ceil((data.usage?.prompt_tokens ?? 0) * 2.5 + (data.usage?.completion_tokens ?? 0) * 10),
    );
    if (!verdict) {
      log.warn("visual QA returned unparseable verdict; passing open");
      return { score: -1, pass: true, criticalDefects: [], minorIssues: [], costMicroUsd: cost };
    }
    return {
      score: verdict.score,
      pass: verdict.criticalDefects.length === 0 && verdict.score >= minScore,
      criticalDefects: verdict.criticalDefects,
      minorIssues: verdict.minorIssues,
      costMicroUsd: cost,
    };
  } catch (err) {
    log.warn({ err }, "visual QA errored; passing open");
    return { score: -1, pass: true, criticalDefects: [], minorIssues: [], costMicroUsd: 0n };
  }
}
