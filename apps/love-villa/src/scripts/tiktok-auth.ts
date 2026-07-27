import { randomBytes } from "node:crypto";
import {
  buildAuthorizeUrl,
  exchangeAuthCode,
  getAccessToken,
  queryCreatorInfo,
  tiktokConfigured,
  tiktokConnected,
} from "../providers/publish/tiktok";
import { parseArgs } from "../utils/args";
import { log } from "../utils/log";

/**
 * Connect the pipeline to a TikTok account (one-time, ~2 minutes):
 *
 *   npm run tiktok-auth                    # step 1: prints the authorize URL
 *   npm run tiktok-auth -- --code <code>   # step 2: paste the code from the redirect URL
 *   npm run tiktok-auth -- --status        # check the current connection
 *
 * Prerequisites (docs/SETUP-APIS.md §4): TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET,
 * and TIKTOK_REDIRECT_URI in .env, matching your app at https://developers.tiktok.com
 */
async function main(): Promise<void> {
  const args = parseArgs();

  if (args.status === true) {
    if (!tiktokConfigured()) {
      log.warn("TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET not set — see docs/SETUP-APIS.md §4");
      return;
    }
    if (!tiktokConnected()) {
      log.warn("No account connected yet — run: npm run tiktok-auth");
      return;
    }
    const tokens = await getAccessToken();
    const info = await queryCreatorInfo(tokens.access_token);
    log.ok(`Connected as @${info.creator_username} (${info.creator_nickname})`);
    log.info(`allowed privacy levels: ${info.privacy_level_options.join(", ")}`);
    log.info(`max video duration: ${info.max_video_post_duration_sec}s`);
    return;
  }

  const code = typeof args.code === "string" ? args.code : null;
  if (!code) {
    const url = buildAuthorizeUrl(randomBytes(8).toString("hex"));
    log.step("TikTok authorization — step 1 of 2");
    log.info("Open this URL in a browser, log into the TikTok account that should post the");
    log.info("episodes, and approve access:");
    console.log(`\n${url}\n`);
    log.info("After approving you'll land on your redirect URI with ?code=XXXX&... in the");
    log.info("address bar. Copy the code value (URL-decoded, up to the first '&') and run:");
    log.info("  npm run tiktok-auth -- --code <paste-code-here>");
    return;
  }

  log.step("TikTok authorization — step 2 of 2");
  const tokens = await exchangeAuthCode(decodeURIComponent(code));
  const info = await queryCreatorInfo(tokens.access_token);
  log.ok(
    `Connected as @${info.creator_username} — tokens saved to data/tiktok-tokens.json (gitignored)`,
  );
  log.info(`granted scopes: ${tokens.scopes}`);
  log.info(`allowed privacy levels: ${info.privacy_level_options.join(", ")}`);
  if (!info.privacy_level_options.includes("PUBLIC_TO_EVERYONE")) {
    log.warn(
      "PUBLIC_TO_EVERYONE is not available — your TikTok app is unaudited, so posts are " +
        "restricted to SELF_ONLY (private) until TikTok approves your app for public posting. " +
        "See docs/SETUP-APIS.md §4.4.",
    );
  }
  log.info("Publish with: npm run publish-episode -- --episode 1");
}

main().catch((err) => {
  log.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
