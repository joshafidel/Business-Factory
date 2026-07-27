import { copyFileSync, existsSync } from "node:fs";
import path from "node:path";
import { loadApprovals, requireApproved, setApproval } from "../approvals/approvals";
import { APP_ROOT, DATA_DIR, OUTPUT_DIR, providerStatus } from "../config";
import { loadEpisodeScript } from "../episodes/episode-generator";
import { loadRenderPlan } from "../render/render-plan";
import { renderEpisodeVideo, renderThumbnail, transcodeWebPreview } from "../render/render";
import { parseArgs, intArg } from "../utils/args";
import { CostTracker } from "../utils/cost";
import { ensureDir, episodeId, readJsonIfExists, writeText } from "../utils/fs";
import { log } from "../utils/log";
import { type AssetManifest } from "./produce-episode";

/**
 * npm run render-episode -- --episode 1
 *
 * Renders the final 1080x1920 MP4 + thumbnail and assembles the complete
 * upload package under output/episodes/episode-NNN/, including the
 * production report. Ends at the "final-export" approval gate.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = intArg(args, "episode");
  const force = args.force === true;

  requireApproved("rough-cut", episode, force);

  const epId = episodeId(episode);
  const plan = loadRenderPlan(episode);
  const script = loadEpisodeScript(episode);
  const outDir = ensureDir(path.join(OUTPUT_DIR, "episodes", epId));
  const tracker = new CostTracker({ episode });

  log.step(`Final render — episode ${episode}: "${script.title}"`);
  const finalFile = path.join(outDir, "final.mp4");
  const result = await renderEpisodeVideo({ plan, outFile: finalFile, draft: false });
  log.ok(`${finalFile} (${result.seconds.toFixed(1)}s, 1080x1920)`);

  log.step("Thumbnail");
  await renderThumbnail(plan, path.join(outDir, "thumbnail.png"));
  log.ok("thumbnail.png");

  log.step("Upload package");
  const dataDir = path.join(DATA_DIR, "episodes", epId);
  for (const f of [
    "script.md",
    "shot-list.json",
    "caption.txt",
    "hashtags.txt",
    "continuity-update.json",
  ]) {
    const src = path.join(dataDir, f);
    if (existsSync(src)) copyFileSync(src, path.join(outDir, f));
  }
  writeText(
    path.join(outDir, "production-report.md"),
    productionReport(episode, result.seconds, tracker),
  );
  log.ok(`output/episodes/${epId}/ complete`);

  // Web preview: 720x1280 stream-friendly copy, dropped into the dashboard's
  // public dir so /apps/love-villa can play it after commit + deploy.
  log.step("Web preview for the dashboard");
  const previewFile = path.join(outDir, "preview.mp4");
  transcodeWebPreview(finalFile, previewFile);
  const webPublic = path.resolve(APP_ROOT, "..", "web", "public");
  if (existsSync(webPublic)) {
    ensureDir(path.join(webPublic, "love-villa"));
    copyFileSync(previewFile, path.join(webPublic, "love-villa", `${epId}.mp4`));
    copyFileSync(
      path.join(outDir, "thumbnail.png"),
      path.join(webPublic, "love-villa", `${epId}-poster.png`),
    );
    log.ok(
      `apps/web/public/love-villa/${epId}.mp4 — commit + deploy to watch it on /apps/love-villa`,
    );
  }

  setApproval("final-export", episode, "pending", `Review output/episodes/${epId}/final.mp4`);
  log.info(`Next: npm run validate-episode -- --episode ${episode}`);
  log.info(`Then: npm run approve -- --stage final-export --episode ${episode}`);
  log.info(
    `Post it: npm run publish-episode -- --episode ${episode} (after tiktok-auth), or upload manually.`,
  );
}

function productionReport(episode: number, seconds: number, tracker: CostTracker): string {
  const status = providerStatus();
  const manifest = readJsonIfExists<AssetManifest>(
    path.join(DATA_DIR, "episodes", episodeId(episode), "assets.json"),
  );
  const approvals = loadApprovals();
  const pending = Object.entries(approvals)
    .filter(([k, v]) => v.status !== "approved" && (k.endsWith(`:${episode}`) || !k.includes(":")))
    .map(([k, v]) => `- ${k}: ${v.status}`);
  const byProvider = new Map<string, { calls: number; usd: number }>();
  for (const e of tracker.entries) {
    const cur = byProvider.get(e.provider) ?? { calls: 0, usd: 0 };
    cur.calls++;
    cur.usd += e.estimatedUsd;
    byProvider.set(e.provider, cur);
  }
  return `# Production report — episode ${episode}

## APIs used

- LLM: ${status.llm === "live" ? "Anthropic (live)" : "mock fixtures (no ANTHROPIC_API_KEY)"}
- Images: ${status.images === "live" ? "OpenAI gpt-image-1 (live)" : "parametric SVG (no OPENAI_API_KEY)"}
- Voices: ${status.tts === "live" ? "ElevenLabs (live)" : "synthesized mock voices (no ELEVENLABS_API_KEY)"}
- Music & SFX: generated locally (royalty-free by construction)
- Motion: Remotion camera moves (image-to-video provider disabled)

## Estimated API cost

${[...byProvider.entries()].map(([p, v]) => `- ${p}: ${v.calls} calls ≈ $${v.usd.toFixed(3)}`).join("\n") || "- no calls recorded"}
- **Episode total ≈ $${tracker.totalUsd.toFixed(2)}** (budget: $5.00)

## Assets

- Characters: ${Object.keys(manifest?.characters ?? {}).length} · Locations: ${Object.keys(manifest?.locations ?? {}).length} · Voice lines: ${manifest?.lines.length ?? 0} · Music bed: 1
- Failed generations: ${manifest?.failures.length ? "\n" + manifest.failures.map((f) => `  - ${f}`).join("\n") : "none"}
- Regenerated assets: ${manifest?.regenerated.length ? "\n" + manifest.regenerated.map((f) => `  - ${f}`).join("\n") : "none"}

## Video

- Duration: ${seconds.toFixed(1)}s (target 60–90s)
- Final: output/episodes/${episodeId(episode)}/final.mp4 (1080x1920)

## Validation warnings

Run \`npm run validate-episode -- --episode ${episode}\` — the report lands in data/episodes/${episodeId(episode)}/validation-report.json.

## Required human decisions

${pending.length ? pending.join("\n") : "- none — all checkpoints approved"}
`;
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
