import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Route protection. JWT session cookie presence is checked here (cheap, edge-
 * safe); full session validation happens server-side in getOrgContext. The
 * sign-in page and auth endpoints stay public.
 */
const PUBLIC_PATHS = ["/sign-in", "/api/auth", "/api/health"];

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }
  const sessionCookie =
    request.cookies.get("authjs.session-token") ??
    request.cookies.get("__Secure-authjs.session-token");
  if (!sessionCookie) {
    const url = new URL("/sign-in", request.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
