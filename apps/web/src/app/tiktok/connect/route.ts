import { NextResponse } from "next/server";

/**
 * Short, typeable entry point for the Love Villa TikTok OAuth flow:
 * /tiktok/connect 302s to TikTok's authorize page with the right client key,
 * scopes, and redirect URI. Exists because the raw authorize URL is ~300
 * characters and gets mangled when copied through chat/messaging apps.
 *
 * Client keys are public identifiers (they appear in every authorize URL), so
 * the sandbox key may live here as a fallback; TIKTOK_CLIENT_KEY overrides it
 * when set in the deployment env (e.g. after production approval).
 */
const CLIENT_KEY = process.env.TIKTOK_CLIENT_KEY ?? "sbawx1kq6epr06yz29";
const REDIRECT_URI = "https://business-factory-woad.vercel.app/tiktok/callback";
const SCOPES = "user.info.basic,video.publish,video.upload";

export function GET(): NextResponse {
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", CLIENT_KEY);
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("state", crypto.randomUUID().replace(/-/g, "").slice(0, 16));
  return NextResponse.redirect(url);
}
