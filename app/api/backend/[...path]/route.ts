import { NextResponse, type NextRequest } from "next/server";

import { buildCallbackUrl } from "@/lib/api/callback-url";
import {
  buildUpstreamPath,
  matchEndpoint,
  type EndpointMatch,
  type HttpMethod,
} from "@/lib/api/endpoints";
import { isAllowedExternalRedirect } from "@/lib/api/redirect";
import { completeResultSchema } from "@/lib/api/schemas/connections";
import { getAccessToken, getSession, requireSession } from "@/lib/auth/server";
import { getConnectionProvider, type ConnectionProvider } from "@/lib/connections";
import { getServerEnv } from "@/lib/env";
import { ApiError, type ApiErrorCode, toErrorResponse } from "@/lib/errors";
import { log, newRequestId } from "@/lib/log";

/**
 * The only browser-facing API surface. The browser never talks to the API
 * service directly and never sees a JWT.
 *
 * Three shapes, all registered in `lib/api/endpoints.ts`:
 *
 * - `json` — relay a validated upstream payload (`GET /api/backend/connections`).
 * - `oauth-start` — the Connect anchor. The browser issues a GET; the BFF
 *   issues the upstream POST with our callback URL, then host-checks the
 *   consent `Location` and hands it to the browser as a 303.
 * - `oauth-complete` — the provider's `redirect_uri`. A top-level navigation
 *   cannot carry a Bearer token, so the BFF supplies it, exchanges the code
 *   upstream, and 303s back to `/connections` with a status flag. It must never
 *   end on a JSON body.
 */
const TIMEOUT_MS = 10_000;
const RETURN_PATH = "/connections";

/** Query length caps: this endpoint is reachable by anyone, not just Google. */
const MAX_CODE_LENGTH = 2_048;
const MAX_STATE_LENGTH = 512;

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

/** A navigation back into the app, carrying only a status flag. */
function connectionsRedirect(
  request: NextRequest,
  params: Record<string, string>,
): NextResponse {
  const url = new URL(RETURN_PATH, request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

/** The user clicked Connect with an expired session; send them to sign in. */
function signInRedirect(request: NextRequest): NextResponse {
  const url = new URL("/auth/sign-in", request.url);
  url.searchParams.set("redirectTo", RETURN_PATH);

  const response = NextResponse.redirect(url, 303);
  response.headers.set("cache-control", "no-store");
  return response;
}

type UpstreamResult =
  | { ok: true; response: Response }
  | { ok: false; reason: "timeout" | "network" };

async function callUpstream(
  path: string,
  token: string,
  init: { method: HttpMethod; body?: string },
): Promise<UpstreamResult> {
  const { API_URL } = getServerEnv();

  try {
    const response = await fetch(`${API_URL}${path}`, {
      method: init.method,
      headers: {
        // Built here from our minted token. Nothing the client sent is
        // forwarded, and the token never leaves this process.
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body
          ? { "content-type": "application/json" }
          : {}),
      },
      body: init.body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    return { ok: true, response };
  } catch (error) {
    const timedOut =
      error instanceof DOMException && error.name === "TimeoutError";
    return { ok: false, reason: timedOut ? "timeout" : "network" };
  }
}

function startFailed(
  request: NextRequest,
  provider: ConnectionProvider,
): NextResponse {
  return connectionsRedirect(request, {
    error: `${provider.id}_start_failed`,
  });
}

function completeFailed(
  request: NextRequest,
  provider: ConnectionProvider,
): NextResponse {
  return connectionsRedirect(request, { error: `${provider.id}_failed` });
}

async function handleStart(
  request: NextRequest,
  match: EndpointMatch,
  provider: ConnectionProvider,
  token: string,
  requestId: string,
  startedAt: number,
): Promise<NextResponse> {
  const result = await callUpstream(buildUpstreamPath(match), token, {
    method: match.endpoint.upstreamMethod ?? "POST",
    body: JSON.stringify({
      redirect_uri: buildCallbackUrl(request.nextUrl.origin, provider.id),
    }),
  });

  if (!result.ok) {
    log("error", "bff.unreachable", {
      requestId,
      route: match.endpoint.id,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return startFailed(request, provider);
  }

  const { response } = result;

  if (response.status === 401) {
    log("warn", "bff.upstream_unauthorized", {
      requestId,
      route: match.endpoint.id,
    });
    return signInRedirect(request);
  }

  const location = response.headers.get("location");

  // The upstream must answer with a 3xx to the provider's consent screen, and
  // only to a host this provider is allowed to use. Never log the Location: it
  // carries the OAuth state.
  if (
    response.status < 300 ||
    response.status >= 400 ||
    !location ||
    !isAllowedExternalRedirect(location, match.endpoint.redirectHosts ?? [])
  ) {
    log("error", "bff.start_rejected", {
      requestId,
      route: match.endpoint.id,
      status: response.status,
      hasLocation: Boolean(location),
      durationMs: Date.now() - startedAt,
    });
    return startFailed(request, provider);
  }

  const redirect = NextResponse.redirect(location, 303);
  redirect.headers.set("cache-control", "no-store");
  redirect.headers.set("x-request-id", requestId);

  log("info", "bff.oauth_start", {
    requestId,
    route: match.endpoint.id,
    status: 303,
    durationMs: Date.now() - startedAt,
  });

  return redirect;
}

async function handleCallback(
  request: NextRequest,
  match: EndpointMatch,
  provider: ConnectionProvider,
  token: string,
  requestId: string,
  startedAt: number,
): Promise<NextResponse> {
  const query = request.nextUrl.searchParams;

  const providerError = query.get("error");
  if (providerError) {
    // `access_denied` is the user pressing Cancel; anything else is a failure.
    // The value is a short slug, safe to log; codes and state are not.
    log("info", "bff.oauth_cancelled", {
      requestId,
      route: match.endpoint.id,
      reason: providerError.slice(0, 64),
    });

    return providerError === "access_denied"
      ? connectionsRedirect(request, { error: "access_denied" })
      : completeFailed(request, provider);
  }

  const code = query.get("code");
  const state = query.get("state");

  if (
    !code ||
    !state ||
    code.length > MAX_CODE_LENGTH ||
    state.length > MAX_STATE_LENGTH
  ) {
    log("warn", "bff.oauth_missing_params", {
      requestId,
      route: match.endpoint.id,
      hasCode: Boolean(code),
      hasState: Boolean(state),
    });
    return completeFailed(request, provider);
  }

  const result = await callUpstream(buildUpstreamPath(match), token, {
    method: match.endpoint.upstreamMethod ?? "POST",
    body: JSON.stringify({
      code,
      state,
      // OpenID Connect callbacks carry `iss`; plain OAuth ones do not, and the
      // API requires it, so fall back to the provider's known issuer.
      iss: query.get("iss") ?? provider.issuer,
      scope: query.get("scope") ?? "",
      redirect_uri: buildCallbackUrl(request.nextUrl.origin, provider.id),
    }),
  });

  if (!result.ok) {
    log("error", "bff.unreachable", {
      requestId,
      route: match.endpoint.id,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return completeFailed(request, provider);
  }

  const { response } = result;

  if (response.status === 401) {
    log("warn", "bff.upstream_unauthorized", {
      requestId,
      route: match.endpoint.id,
    });
    return connectionsRedirect(request, { error: "session_expired" });
  }

  if (response.status !== 200) {
    log("error", "bff.complete_rejected", {
      requestId,
      route: match.endpoint.id,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return completeFailed(request, provider);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const parsed = completeResultSchema.safeParse(payload);
  if (!parsed.success) {
    log("error", "bff.complete_unexpected_payload", {
      requestId,
      route: match.endpoint.id,
      durationMs: Date.now() - startedAt,
    });
    return completeFailed(request, provider);
  }

  log(parsed.data.connected ? "info" : "warn", "bff.oauth_complete", {
    requestId,
    route: match.endpoint.id,
    connected: parsed.data.connected,
    durationMs: Date.now() - startedAt,
  });

  return parsed.data.connected
    ? connectionsRedirect(request, { connected: provider.id })
    : completeFailed(request, provider);
}

async function handleJson(
  request: NextRequest,
  match: EndpointMatch,
  token: string,
  requestId: string,
  startedAt: number,
): Promise<NextResponse> {
  const result = await callUpstream(buildUpstreamPath(match), token, {
    method: match.endpoint.upstreamMethod ?? match.endpoint.method,
  });

  if (!result.ok) {
    log("error", "bff.unreachable", {
      requestId,
      route: match.endpoint.id,
      reason: result.reason,
      durationMs: Date.now() - startedAt,
    });
    return result.reason === "timeout"
      ? errorResponse(504, "TIMEOUT", requestId)
      : errorResponse(502, "NETWORK", requestId);
  }

  const { response } = result;

  if (response.status === 401) {
    log("warn", "bff.upstream_unauthorized", {
      requestId,
      route: match.endpoint.id,
    });
    return signInRedirect(request);
  }

  if (response.status !== 200) {
    log("error", "bff.unexpected_status", {
      requestId,
      route: match.endpoint.id,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(502, "UPSTREAM", requestId);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const schema = match.endpoint.response;
  const parsed = schema
    ? schema.safeParse(payload)
    : ({ success: true, data: payload } as const);

  if (!parsed.success) {
    log("error", "bff.unexpected_payload", {
      requestId,
      route: match.endpoint.id,
      durationMs: Date.now() - startedAt,
    });
    return errorResponse(502, "UPSTREAM", requestId);
  }

  log("info", "bff.json", {
    requestId,
    route: match.endpoint.id,
    status: 200,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(parsed.data, {
    status: 200,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const startedAt = Date.now();
  const requestId = newRequestId();
  const { path } = await params;
  const pathname = `/${path.join("/")}`;

  // Match against the registry first: it is pure, and it tells us which auth
  // failure mode applies before any network call happens.
  const match = matchEndpoint(request.method, pathname);
  if (!match) {
    log("warn", "bff.rejected", { requestId, route: pathname, status: 404 });
    return errorResponse(404, "NOT_FOUND", requestId);
  }

  const providerId = match.params.provider;
  const provider = providerId ? getConnectionProvider(providerId) : undefined;

  if (providerId && !provider) {
    // The registry only allows ids from the provider list, so this means the
    // two drifted apart. Fail closed rather than guess.
    log("error", "bff.registry_mismatch", {
      requestId,
      route: match.endpoint.id,
    });
    return errorResponse(500, "INTERNAL", requestId);
  }

  /*
   * Authorization is the boundary, not `proxy.ts`. The OAuth callback is a
   * top-level navigation, so a missing session must come back as a redirect
   * into the app instead of a sign-in bounce that would drop the code.
   */
  if (match.endpoint.kind === "oauth-complete") {
    const session = await getSession();
    if (!session) {
      log("warn", "bff.callback_no_session", {
        requestId,
        route: match.endpoint.id,
      });
      return connectionsRedirect(request, { error: "session_expired" });
    }
  } else {
    await requireSession(RETURN_PATH);
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return match.endpoint.kind === "oauth-complete"
        ? connectionsRedirect(request, { error: "session_expired" })
        : signInRedirect(request);
    }

    log("error", "bff.token_failed", {
      requestId,
      route: match.endpoint.id,
      durationMs: Date.now() - startedAt,
    });

    return match.endpoint.kind === "oauth-complete"
      ? connectionsRedirect(request, { error: "session_expired" })
      : errorResponse(502, "UPSTREAM", requestId);
  }

  switch (match.endpoint.kind) {
    case "oauth-start": {
      if (!provider) return errorResponse(500, "INTERNAL", requestId);
      return handleStart(
        request,
        match,
        provider,
        token,
        requestId,
        startedAt,
      );
    }

    case "oauth-complete": {
      if (!provider) return errorResponse(500, "INTERNAL", requestId);
      return handleCallback(
        request,
        match,
        provider,
        token,
        requestId,
        startedAt,
      );
    }

    case "json":
      return handleJson(request, match, token, requestId, startedAt);
  }
}
