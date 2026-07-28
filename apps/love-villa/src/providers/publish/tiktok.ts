import path from "node:path";
import { DATA_DIR, loadConfig } from "../../config";
import { readJsonIfExists, writeJson } from "../../utils/fs";
import { log } from "../../utils/log";

/**
 * TikTok Content Posting API (v2) adapter — direct post.
 * Docs: https://developers.tiktok.com/doc/content-posting-api-get-started/
 *
 * Auth model: you create a TikTok developer app (client key + secret), the
 * account owner authorizes it once via OAuth (npm run tiktok-auth), and the
 * rotating refresh token is persisted in data/tiktok-tokens.json (gitignored).
 *
 * IMPORTANT: until your TikTok app passes TikTok's audit, the API restricts
 * every post to SELF_ONLY (private/"only me") visibility. This is a TikTok
 * platform rule, not a pipeline limitation — see the setup guide.
 */

const TOKEN_FILE = path.join(DATA_DIR, "tiktok-tokens.json");
const API = "https://open.tiktokapis.com/v2";

async function fetchOpts(): Promise<Record<string, unknown>> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return {};
  const { ProxyAgent } = await import("undici");
  return { dispatcher: new ProxyAgent(proxy) };
}

export interface TikTokTokens {
  access_token: string;
  refresh_token: string;
  open_id: string;
  /** Epoch ms when the access token expires. */
  expires_at: number;
  /** Epoch ms when the refresh token expires (~365 days). */
  refresh_expires_at: number;
  scopes: string;
}

export function tiktokConfigured(): boolean {
  const env = loadConfig();
  return Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET);
}

export function tiktokConnected(): boolean {
  return readJsonIfExists<TikTokTokens>(TOKEN_FILE) != null;
}

export function buildAuthorizeUrl(state: string): string {
  const env = loadConfig();
  if (!env.TIKTOK_CLIENT_KEY || !env.TIKTOK_REDIRECT_URI) {
    throw new Error(
      "Set TIKTOK_CLIENT_KEY and TIKTOK_REDIRECT_URI in .env first (see docs/SETUP-APIS.md).",
    );
  }
  const params = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY,
    scope: "user.info.basic,video.publish,video.upload",
    response_type: "code",
    redirect_uri: env.TIKTOK_REDIRECT_URI,
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  refresh_expires_in: number;
  open_id: string;
  scope: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TikTokTokens> {
  const res = await fetch(`${API}/oauth/token/`, {
    ...(await fetchOpts()),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = (await res.json()) as TokenResponse;
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(
      `TikTok token request failed (${res.status}): ${data.error ?? ""} ${data.error_description ?? ""}`,
    );
  }
  const tokens: TikTokTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    open_id: data.open_id,
    expires_at: Date.now() + data.expires_in * 1000,
    refresh_expires_at: Date.now() + data.refresh_expires_in * 1000,
    scopes: data.scope,
  };
  // TikTok ROTATES refresh tokens — always persist the newest one.
  writeJson(TOKEN_FILE, tokens);
  return tokens;
}

/** Exchange the OAuth authorization code (from the redirect URL) for tokens. */
export async function exchangeAuthCode(code: string): Promise<TikTokTokens> {
  const env = loadConfig();
  return tokenRequest({
    client_key: env.TIKTOK_CLIENT_KEY ?? "",
    client_secret: env.TIKTOK_CLIENT_SECRET ?? "",
    code,
    grant_type: "authorization_code",
    redirect_uri: env.TIKTOK_REDIRECT_URI ?? "",
  });
}

/** Load tokens, refreshing the access token when it's within 5 minutes of expiry. */
export async function getAccessToken(): Promise<TikTokTokens> {
  const env = loadConfig();
  const tokens = readJsonIfExists<TikTokTokens>(TOKEN_FILE);
  if (!tokens) {
    throw new Error(
      "TikTok account not connected. Run: npm run tiktok-auth (see docs/SETUP-APIS.md, section 4).",
    );
  }
  if (Date.now() < tokens.expires_at - 5 * 60_000) return tokens;
  if (Date.now() > tokens.refresh_expires_at) {
    throw new Error("TikTok refresh token expired — re-run: npm run tiktok-auth");
  }
  log.info("refreshing TikTok access token…");
  return tokenRequest({
    client_key: env.TIKTOK_CLIENT_KEY ?? "",
    client_secret: env.TIKTOK_CLIENT_SECRET ?? "",
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
  });
}

export interface CreatorInfo {
  creator_username: string;
  creator_nickname: string;
  privacy_level_options: string[];
  max_video_post_duration_sec: number;
  comment_disabled: boolean;
  duet_disabled: boolean;
  stitch_disabled: boolean;
}

/** Required by TikTok before every direct post: current creator constraints. */
export async function queryCreatorInfo(accessToken: string): Promise<CreatorInfo> {
  const res = await fetch(`${API}/post/publish/creator_info/query/`, {
    ...(await fetchOpts()),
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  });
  const body = (await res.json()) as {
    data?: CreatorInfo;
    error?: { code: string; message: string };
  };
  if (!res.ok || !body.data || (body.error && body.error.code !== "ok")) {
    throw new Error(
      `TikTok creator_info failed (${res.status}): ${body.error?.code} ${body.error?.message ?? ""}`,
    );
  }
  return body.data;
}

export interface DirectPostResult {
  publishId: string;
  status: string;
  publiclyAvailablePostId?: string;
}

const MAX_SINGLE_CHUNK = 64 * 1024 * 1024;
const CHUNK_SIZE = 10 * 1024 * 1024;

/**
 * Direct-post a video (FILE_UPLOAD source): init → chunked PUT upload →
 * poll status until PUBLISH_COMPLETE / FAILED.
 */
export async function directPostVideo(params: {
  accessToken: string;
  videoData: Buffer;
  title: string;
  privacyLevel: string;
  coverTimestampMs?: number;
}): Promise<DirectPostResult> {
  const { accessToken, videoData, title, privacyLevel } = params;
  const size = videoData.byteLength;
  const single = size <= MAX_SINGLE_CHUNK;
  const chunkSize = single ? size : CHUNK_SIZE;
  const totalChunks = single ? 1 : Math.floor(size / chunkSize);

  const init = await fetch(`${API}/post/publish/video/init/`, {
    ...(await fetchOpts()),
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      post_info: {
        title: title.slice(0, 2200),
        privacy_level: privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: params.coverTimestampMs ?? 1000,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  });
  const initBody = (await init.json()) as {
    data?: { publish_id: string; upload_url: string };
    error?: { code: string; message: string };
  };
  if (!init.ok || !initBody.data || (initBody.error && initBody.error.code !== "ok")) {
    throw new Error(
      `TikTok post init failed (${init.status}): ${initBody.error?.code} ${initBody.error?.message ?? ""}`,
    );
  }
  const { publish_id, upload_url } = initBody.data;

  // Upload chunks. The final chunk absorbs the remainder bytes.
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = i === totalChunks - 1 ? size : start + chunkSize;
    const chunk = videoData.subarray(start, end);
    const up = await fetch(upload_url, {
      ...(await fetchOpts()),
      method: "PUT",
      headers: {
        "content-type": "video/mp4",
        // No manual content-length: undici derives it from the body and
        // rejects a duplicate (UND_ERR_INVALID_ARG "invalid content-length").
        "content-range": `bytes ${start}-${end - 1}/${size}`,
      },
      body: new Uint8Array(chunk),
    });
    if (!up.ok && up.status !== 201) {
      throw new Error(
        `TikTok chunk upload failed (${up.status}): ${(await up.text()).slice(0, 200)}`,
      );
    }
    log.info(`uploaded chunk ${i + 1}/${totalChunks}`);
  }

  // Poll publish status (bounded).
  const deadline = Date.now() + 3 * 60_000;
  let status = "PROCESSING_UPLOAD";
  let postId: string | undefined;
  while (Date.now() < deadline) {
    const res = await fetch(`${API}/post/publish/status/fetch/`, {
      ...(await fetchOpts()),
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ publish_id }),
    });
    const body = (await res.json()) as {
      data?: { status: string; publicaly_available_post_id?: string[]; fail_reason?: string };
      error?: { code: string; message: string };
    };
    status = body.data?.status ?? "UNKNOWN";
    if (status === "PUBLISH_COMPLETE") {
      postId = body.data?.publicaly_available_post_id?.[0];
      break;
    }
    if (status === "FAILED") {
      throw new Error(`TikTok publish failed: ${body.data?.fail_reason ?? "unknown reason"}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return { publishId: publish_id, status, publiclyAvailablePostId: postId };
}
