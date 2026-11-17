import { NextResponse, type NextRequest } from "next/server";
import type { ZodType } from "zod";

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
import { OAUTH_POPUP_COOKIE } from "@/lib/oauth-popup";

/**
 * The only browser-facing API surface. The browser never talks to the API
 * service directly and never sees a JWT here (`/api/token` is the one explicit
 * exception — see AGENTS.md §5.2).
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
/** Bare completion page rendered inside the popup; it messages the opener. */
const POPUP_RETURN_PATH = "/connections/complete";

/** Query length caps: this endpoint is reachable by anyone, not just Google. */
const MAX_CODE_LENGTH = 2_048;
const MAX_STATE_LENGTH = 512;
/** Inbound JSON cap. The only body today is a project draft. */
const MAX_BODY_BYTES = 16 * 1024;

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

/** A non-empty marker cookie means the flow was started in a popup. */
function isPopupRequest(request: NextRequest): boolean {
  const value = request.cookies.get(OAUTH_POPUP_COOKIE)?.value;
  return typeof value === "string" && value.length > 0;
}

/** A navigation back into the app, carrying only a status flag. */
function connectionsRedirect(
  request: NextRequest,
  params: Record<string, string>,
): NextResponse {
  /*
   * The connect anchor sets this marker before opening the popup. The provider
   * only redirects to the one registered callback, so this cookie is the only
   * way the callback can tell it is running in a popup.
   */
  const popup = isPopupRequest(request);
  const url = new URL(popup ? POPUP_RETURN_PATH : RETURN_PATH, request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const response = NextResponse.redirect(url, 303);
  if (popup) {
    response.cookies.set({
      name: OAUTH_POPUP_COOKIE,
      value: "",
      path: "/",
      maxAge: 0,
      sameSite: "lax",
      httpOnly: false,
    });
  }
  response.headers.set("cache-control", "no-store");
  return response;
}

/** The user clicked Connect with an expired session; send them to sign in. */
function signInRedirect(request: NextRequest): NextResponse {
  // Inside a popup a sign-in form would be a dead end: close it and let the
  // opener explain why. The parent refresh will redirect if it is also expired.
  if (isPopupRequest(request)) {
    return connectionsRedirect(request, { error: "session_expired" });
  }

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

type BodyRead =
  | { ok: true; body: string }
  | { ok: false; response: NextResponse };

/**
 * Reads a JSON body, enforces a small cap, and keeps only what the registry
 * schema declares. Unknown keys are dropped rather than forwarded.
 */
async function readRequestBody(
  request: NextRequest,
  schema: ZodType,
  requestId: string,
): Promise<BodyRead> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    log("warn", "bff.body_too_large", { requestId, bytes: declared });
    return { ok: false, response: errorResponse(413, "VALIDATION", requestId) };
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    log("warn", "bff.body_too_large", { requestId, bytes: text.length });
    return { ok: false, response: errorResponse(413, "VALIDATION", requestId) };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    log("warn", "bff.body_invalid_json", { requestId });
    return { ok: false, response: errorResponse(400, "VALIDATION", requestId) };
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    // Never log the payload: it carries a user-supplied URL.
    log("warn", "bff.body_rejected", {
      requestId,
      issues: parsed.error.issues.length,
    });
    return { ok: false, response: errorResponse(400, "VALIDATION", requestId) };
  }

  return { ok: true, body: JSON.stringify(parsed.data) };
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
  let body: string | undefined;

  if (match.endpoint.request) {
    const read = await readRequestBody(
      request,
      match.endpoint.request,
      requestId,
    );
    if (!read.ok) return read.response;
    body = read.body;
  }

  const result = await callUpstream(buildUpstreamPath(match), token, {
    method: match.endpoint.upstreamMethod ?? match.endpoint.method,
    body,
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
    // A fetch call cannot use a sign-in redirect: the browser would follow it
    // and the caller would parse the sign-in page as a result.
    return errorResponse(401, "UNAUTHORIZED", requestId);
  }

  if (response.status < 200 || response.status >= 300) {
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
    status: response.status,
    durationMs: Date.now() - startedAt,
  });

  return NextResponse.json(parsed.data, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
    },
  });
}

interface Preflight {
  match: EndpointMatch;
  provider?: ConnectionProvider;
  token: string;
}

type PreflightResult =
  | { ok: true; preflight: Preflight }
  | { ok: false; response: NextResponse };

/**
 * Shared by every verb: match the registry, resolve the provider, authorize,
 * and mint the upstream token. Deny-by-default happens before any network call.
 */
async function prepareRequest(
  request: NextRequest,
  pathname: string,
  requestId: string,
  startedAt: number,
): Promise<PreflightResult> {
  const match = matchEndpoint(request.method, pathname);
  if (!match) {
    log("warn", "bff.rejected", { requestId, route: pathname, status: 404 });
    return { ok: false, response: errorResponse(404, "NOT_FOUND", requestId) };
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
    return { ok: false, response: errorResponse(500, "INTERNAL", requestId) };
  }

  /*
   * Authorization is the boundary, not `proxy.ts`. Two failure shapes:
   *
   * - A top-level navigation (the Connect anchor and the provider callback)
   *   must be redirected into the app, or a sign-in bounce would drop the
   *   OAuth code.
   * - A fetch to a JSON endpoint must answer 401, so the client can redirect
   *   itself. A 307 here would be followed transparently by `fetch` and the
   *   caller would parse a sign-in page as if it were success.
   */
  if (match.endpoint.kind === "oauth-complete") {
    const session = await getSession();
    if (!session) {
      log("warn", "bff.callback_no_session", {
        requestId,
        route: match.endpoint.id,
      });
      return {
        ok: false,
        response: connectionsRedirect(request, { error: "session_expired" }),
      };
    }
  } else if (match.endpoint.kind === "json") {
    const session = await getSession();
    if (!session) {
      log("warn", "bff.no_session", {
        requestId,
        route: match.endpoint.id,
      });
      return {
        ok: false,
        response: errorResponse(401, "UNAUTHORIZED", requestId),
      };
    }
  } else {
    await requireSession(RETURN_PATH);
  }

  let token: string;
  try {
    token = await getAccessToken();
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return {
        ok: false,
        response:
          match.endpoint.kind === "oauth-complete"
            ? connectionsRedirect(request, { error: "session_expired" })
            : match.endpoint.kind === "json"
              ? errorResponse(401, "UNAUTHORIZED", requestId)
              : signInRedirect(request),
      };
    }

    log("error", "bff.token_failed", {
      requestId,
      route: match.endpoint.id,
      durationMs: Date.now() - startedAt,
    });

    return {
      ok: false,
      response:
        match.endpoint.kind === "oauth-complete"
          ? connectionsRedirect(request, { error: "session_expired" })
          : errorResponse(502, "UPSTREAM", requestId),
    };
  }

  return { ok: true, preflight: { match, provider, token } };
}

async function resolvePath(
  params: Promise<{ path: string[] }>,
): Promise<string> {
  const { path } = await params;
  return `/${path.join("/")}`;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const startedAt = Date.now();
  const requestId = newRequestId();
  const pathname = await resolvePath(params);

  const preflight = await prepareRequest(
    request,
    pathname,
    requestId,
    startedAt,
  );
  if (!preflight.ok) return preflight.response;

  const { match, provider, token } = preflight.preflight;

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

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const startedAt = Date.now();
  const requestId = newRequestId();
  const pathname = await resolvePath(params);

  const preflight = await prepareRequest(
    request,
    pathname,
    requestId,
    startedAt,
  );
  if (!preflight.ok) return preflight.response;

  const { match, token } = preflight.preflight;

  /*
   * `matchEndpoint` already filtered by verb, so anything that reaches here is
   * registered as POST. Only the JSON relay knows what to do with a body; a
   * future POST entry of another kind is a registry mistake, not a request we
   * can serve.
   */
  if (match.endpoint.kind !== "json") {
    log("error", "bff.registry_mismatch", {
      requestId,
      route: match.endpoint.id,
      method: request.method,
    });
    return errorResponse(500, "INTERNAL", requestId);
  }

  return handleJson(request, match, token, requestId, startedAt);
}
