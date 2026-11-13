import { NextResponse, type NextRequest } from "next/server";

import { buildUpstreamPath, matchEndpoint } from "@/lib/api/endpoints";
import { isAllowedExternalRedirect } from "@/lib/api/redirect";
import { getAccessToken, requireSession } from "@/lib/auth/server";
import { getServerEnv } from "@/lib/env";
import { ApiError, type ApiErrorCode, toErrorResponse } from "@/lib/errors";
import { log, newRequestId } from "@/lib/log";

/**
 * The only browser-facing API surface. The browser never talks to the API
 * service directly and never sees a JWT.
 *
 * This phase implements the OAuth *start* flow: the upstream answers with a
 * redirect to the provider's consent screen. A `fetch` with `redirect: "manual"`
 * keeps that `Location` server-side until we have validated its host; the
 * browser then receives a 303 and navigates there itself.
 */
const TIMEOUT_MS = 10_000;
const RETURN_PATH = "/connections";

function errorResponse(
  status: number,
  code: ApiErrorCode,
  requestId: string,
): NextResponse {
  const { body, status: responseStatus } = toErrorResponse(
    new ApiError({ status, code, requestId }),
    requestId,
  );

  return NextResponse.json(body, {
    status: responseStatus,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

/** The user clicked Connect with an expired session; send them to sign in. */
function signInRedirect(request: NextRequest): NextResponse {
  const url = new URL("/auth/sign-in", request.url);
  url.searchParams.set("redirectTo", RETURN_PATH);

  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const startedAt = Date.now();
  const requestId = newRequestId();
  const { path } = await params;
  const pathname = `/${path.join("/")}`;

  // Authorization first — even the allowlist is behind the session.
  await requireSession(RETURN_PATH);

  const match = matchEndpoint(request.method, pathname);
  if (!match) {
    log("warn", "bff.rejected", { requestId, route: pathname, status: 404 });
    return errorResponse(404, "NOT_FOUND", requestId);
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return signInRedirect(request);
    }

    log("error", "bff.token_failed", {
      requestId,
      route: match.endpoint.id,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(502, "UPSTREAM", requestId);
  }

  const { API_URL } = getServerEnv();

  let upstream: Response;
  try {
    upstream = await fetch(`${API_URL}${buildUpstreamPath(match)}`, {
      method: match.endpoint.method,
      headers: {
        // Built here from our minted token; client-supplied headers are never
        // forwarded (there are none we read, but the point stands).
        authorization: `Bearer ${token}`,
        accept: "application/json",
      },
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";

    log("error", "bff.unreachable", {
      requestId,
      route: match.endpoint.id,
      timedOut,
      durationMs: Date.now() - startedAt,
    });

    return timedOut
      ? errorResponse(504, "TIMEOUT", requestId)
      : errorResponse(502, "NETWORK", requestId);
  }

  if (upstream.status === 401) {
    log("warn", "bff.upstream_unauthorized", {
      requestId,
      route: match.endpoint.id,
    });
    return signInRedirect(request);
  }

  if (upstream.status < 300 || upstream.status >= 400) {
    log("error", "bff.unexpected_status", {
      requestId,
      route: match.endpoint.id,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(502, "UPSTREAM", requestId);
  }

  const location = upstream.headers.get("location");

  if (
    !location ||
    !isAllowedExternalRedirect(location, match.endpoint.redirectHosts ?? [])
  ) {
    // Never log the Location: it carries the OAuth state.
    log("error", "bff.redirect_blocked", {
      requestId,
      route: match.endpoint.id,
      status: upstream.status,
      hasLocation: Boolean(location),
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(502, "UPSTREAM", requestId);
  }

  const response = NextResponse.redirect(location, 303);
  response.headers.set("cache-control", "no-store");
  response.headers.set("x-request-id", requestId);

  log("info", "bff.redirect", {
    requestId,
    route: match.endpoint.id,
    status: 303,
    durationMs: Date.now() - startedAt,
  });

  return response;
}
