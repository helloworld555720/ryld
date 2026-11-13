import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic, cookie-presence check only. It exists to avoid rendering the
 * authenticated shell for anonymous visitors; it is NOT authorization.
 * The real check is `requireSession()` in the (app) layout, which validates
 * the session against the auth service.
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts`. See node_modules docs.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies
    .getAll()
    // Matches both `better-auth.session_token` and the `__Secure-` variant.
    .some(({ name }) => name.includes("better-auth.session_token"));

  if (hasSessionCookie) return NextResponse.next();

  const signInUrl = new URL("/auth/sign-in", request.url);
  signInUrl.searchParams.set(
    "redirectTo",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
