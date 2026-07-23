import { loadEnv } from "@bf/config";
import { createLogger } from "@bf/shared";

const log = createLogger("publisher:youtube");

/** Honor HTTPS_PROXY (corporate/sandbox egress) — no-op when unset. */
async function fetchOpts(): Promise<Record<string, unknown>> {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy) return {};
  const { ProxyAgent } = await import("undici");
  return { dispatcher: new ProxyAgent(proxy) };
}

export interface YouTubeUploadParams {
  title: string;
  description: string;
  tags: string[];
  /** Children's content flag — REQUIRED true for the kids-shorts module (COPPA). */
  madeForKids: boolean;
  videoData: Buffer;
  mimeType: string;
  /** "private" is the safe default; flip to public once the channel is trusted. */
  privacyStatus?: "private" | "unlisted" | "public";
}

export interface YouTubeUploadResult {
  videoId: string;
  url: string;
}

/** True when all three YouTube OAuth credentials are configured. */
export function youtubeConfigured(): boolean {
  const env = loadEnv();
  return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN);
}

async function accessToken(): Promise<string> {
  const env = loadEnv();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    ...(await fetchOpts()),
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID ?? "",
      client_secret: env.YOUTUBE_CLIENT_SECRET ?? "",
      refresh_token: env.YOUTUBE_REFRESH_TOKEN ?? "",
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    throw new Error(`YouTube token refresh failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

/**
 * Upload a video via the YouTube Data API v3 resumable upload flow.
 * Notes:
 *  - Uploads from unverified Google Cloud OAuth apps are locked PRIVATE by
 *    YouTube until the app passes an audit — plan for private-first publishing.
 *  - selfDeclaredMadeForKids is set from madeForKids (COPPA requirement for
 *    children's content).
 */
export async function uploadToYouTube(params: YouTubeUploadParams): Promise<YouTubeUploadResult> {
  const token = await accessToken();
  const metadata = {
    snippet: {
      title: params.title.slice(0, 100),
      description: params.description.slice(0, 4900),
      tags: params.tags.slice(0, 30),
      categoryId: "15", // Pets & Animals
    },
    status: {
      privacyStatus: params.privacyStatus ?? "private",
      selfDeclaredMadeForKids: params.madeForKids,
    },
  };

  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      ...(await fetchOpts()),
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-upload-content-type": params.mimeType,
        "x-upload-content-length": String(params.videoData.byteLength),
      },
      body: JSON.stringify(metadata),
    },
  );
  if (!init.ok) {
    throw new Error(`YouTube upload init failed (${init.status}): ${(await init.text()).slice(0, 300)}`);
  }
  const uploadUrl = init.headers.get("location");
  if (!uploadUrl) throw new Error("YouTube upload init returned no upload URL");

  const upload = await fetch(uploadUrl, {
    ...(await fetchOpts()),
    method: "PUT",
    headers: { "content-type": params.mimeType },
    body: new Uint8Array(params.videoData),
  });
  if (!upload.ok) {
    throw new Error(`YouTube upload failed (${upload.status}): ${(await upload.text()).slice(0, 300)}`);
  }
  const video = (await upload.json()) as { id: string };
  log.info({ videoId: video.id }, "uploaded to YouTube");
  return { videoId: video.id, url: `https://www.youtube.com/watch?v=${video.id}` };
}
