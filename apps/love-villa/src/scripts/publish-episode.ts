import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { requireApproved } from "../approvals/approvals";
import { DATA_DIR, OUTPUT_DIR, loadConfig } from "../config";
import {
  directPostVideo,
  getAccessToken,
  queryCreatorInfo,
  tiktokConfigured,
} from "../providers/publish/tiktok";
import { parseArgs, intArg } from "../utils/args";
import { episodeId, readJsonIfExists, writeJson } from "../utils/fs";
import { log } from "../utils/log";

/**
 * npm run publish-episode -- --episode 1 [--privacy SELF_ONLY] [--yes]
 *
 * Posts the rendered, final-export-approved episode to the connected TikTok
 * account via the Content Posting API (direct post). Caption = caption.txt +
 * hashtags.txt. Defaults to the SAFEST available privacy level; pass
 * --privacy PUBLIC_TO_EVERYONE once your TikTok app is audited.
 */
async function main(): Promise<void> {
  const args = parseArgs();
  const episode = intArg(args, "episode");
  const force = args.force === true;
  const epId = episodeId(episode);
  const env = loadConfig();

  if (!tiktokConfigured()) {
    throw new Error(
      "TikTok app not configured — set TIKTOK_CLIENT_KEY/SECRET (docs/SETUP-APIS.md §4).",
    );
  }
  // Publishing is the one irreversible step — it requires the final gate.
  requireApproved("final-export", episode, force);

  const outDir = path.join(OUTPUT_DIR, "episodes", epId);
  const videoFile = path.join(outDir, "final.mp4");
  if (!existsSync(videoFile)) {
    throw new Error(
      `No final.mp4 for episode ${episode} — run: npm run render-episode -- --episode ${episode}`,
    );
  }
  const receiptFile = path.join(DATA_DIR, "episodes", epId, "publish.json");
  const previous = readJsonIfExists<{ publishId: string }>(receiptFile);
  if (previous && args.yes !== true && !force) {
    throw new Error(
      `Episode ${episode} was already published (publish_id ${previous.publishId}). ` +
        `Pass --yes to post it again.`,
    );
  }

  const caption = readFileSync(path.join(outDir, "caption.txt"), "utf8").trim();
  const hashtags = readFileSync(path.join(outDir, "hashtags.txt"), "utf8").trim();
  const title = `${caption}\n${hashtags}`;

  log.step(`Publishing episode ${episode} to TikTok`);
  const tokens = await getAccessToken();
  const info = await queryCreatorInfo(tokens.access_token);
  log.info(`account: @${info.creator_username}`);

  const requested = typeof args.privacy === "string" ? args.privacy : env.TIKTOK_PRIVACY;
  const privacy = info.privacy_level_options.includes(requested)
    ? requested
    : (info.privacy_level_options.find((p) => p === "SELF_ONLY") ?? info.privacy_level_options[0]);
  if (!privacy) throw new Error("TikTok returned no allowed privacy levels for this account.");
  if (privacy !== requested) {
    log.warn(
      `privacy "${requested}" not allowed for this account/app (unaudited apps are SELF_ONLY-only) — using "${privacy}"`,
    );
  }

  const videoData = readFileSync(videoFile);
  log.info(`uploading ${(videoData.byteLength / 1048576).toFixed(1)} MB, privacy: ${privacy}`);
  const result = await directPostVideo({
    accessToken: tokens.access_token,
    videoData,
    title,
    privacyLevel: privacy,
  });

  writeJson(receiptFile, {
    publishId: result.publishId,
    status: result.status,
    postId: result.publiclyAvailablePostId ?? null,
    privacy,
    account: info.creator_username,
    at: new Date().toISOString(),
  });
  if (result.status === "PUBLISH_COMPLETE") {
    log.ok(
      `published (publish_id ${result.publishId}${result.publiclyAvailablePostId ? `, post ${result.publiclyAvailablePostId}` : ""})`,
    );
    if (privacy === "SELF_ONLY") {
      log.info(
        "The post is PRIVATE (visible only to the account) until your TikTok app is audited.",
      );
    }
  } else {
    log.warn(
      `upload accepted; last status: ${result.status} — TikTok is still processing. Receipt saved.`,
    );
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
