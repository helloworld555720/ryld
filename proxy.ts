import { NextResponse, type NextRequest } from "next/server";

import { buildCsp, mediaOriginOf, newNonce } from "@/lib/csp";

/**
 * Optimistic, cookie-presence check only. It exists to avoid rendering the
 * authenticated shell for anonymous visitors; it is NOT authorization.
 * The real check is `requireSession()` in the (app) layout, which validates
 * the session against the auth service.
 *
 * It also issues the per-request CSP nonce (Next 16 renamed middleware to
 * proxy; nonces must be generated per request, before rendering).
 */
const PROTECTED_PREFIXES = [
  "/home",
  "/connections",
  "/api-token",
  "/dashboard",
];

function isProtected(pathname: string): boolean {
  return PROTECTED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  const nonce = newNonce();

  const mediaOrigins = [
    mediaOriginOf(process.env.MEDIA_BASE_URL),
    mediaOriginOf(process.env.MEDIA_SEGMENT_BASE_URL),
  ].filter((o): o is string => !!o);

  const csp = buildCsp({
    nonce,
    isDev: process.env.NODE_ENV === "development",
    // Read directly, not through `getServerEnv()`: proxy runs for every page,
    // and a missing API_URL must not turn that into a 500 before the layout can
    // render its own error.
    mediaOrigins,
  });

  const requestHeaders = new Headers(request.headers);
  // Next reads the nonce back out of the CSP request header and applies it to
  // its own script tags; `x-nonce` is available for our own <Script> usage.
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const { pathname, search } = request.nextUrl;

  const hasSessionCookie = request.cookies
    .getAll()
    // Matches both `better-auth.session_token` and the `__Secure-` variant.
    .some(({ name }) => name.includes("better-auth.session_token"));

  if (isProtected(pathname) && !hasSessionCookie) {
    const signInUrl = new URL("/auth/sign-in", request.url);
    signInUrl.searchParams.set("redirectTo", pathname + search);

    const redirect = NextResponse.redirect(signInUrl);
    redirect.headers.set("content-security-policy", csp);
    return redirect;
  }

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("content-security-policy", csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * Every page route, excluding API handlers and static assets (which need no
     * CSP), and skipping prefetches: those return an RSC payload, not HTML.
     */
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
