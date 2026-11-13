import { narrowSetCookie } from "@/lib/auth/cookies";
import { getServerEnv } from "@/lib/env";
import { toErrorResponse } from "@/lib/errors";
import { log, newRequestId } from "@/lib/log";

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Request headers worth forwarding. Everything else is dropped: this is an
 * allowlist, so a new header can never be leaked to the auth service by default.
 * `authorization` is deliberately absent — the browser never supplies credentials
 * to this proxy, and we never forward one.
 */
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "origin",
  "referer",
  "user-agent",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
] as const;

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "cache-control",
  "pragma",
  "expires",
  "location",
] as const;

const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function buildTargetUrl(segments: string[], search: string): URL {
  const { AUTH_SERVICE_URL } = getServerEnv();

  for (const segment of segments) {
    // Encoded traversal can still arrive decoded by the framework.
    if (
      segment === "." ||
      segment === ".." ||
      segment.includes("/") ||
      segment.includes("\\")
    ) {
      throw new Error("invalid path segment");
    }
  }

  const suffix = segments.length > 0 ? `/${segments.join("/")}` : "";
  const url = new URL(`${AUTH_SERVICE_URL}/api/auth${suffix}`);
  url.search = search;
  return url;
}

type Context = { params: Promise<{ all: string[] }> };

async function handler(request: Request, context: Context): Promise<Response> {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const requestUrl = new URL(request.url);
  const { all } = await context.params;
  const method = request.method.toUpperCase();

  try {
    if (!ALLOWED_METHODS.has(method)) {
      return new Response(null, { status: 405, headers: { allow: "GET, POST, PUT, PATCH, DELETE" } });
    }

    const target = buildTargetUrl(all, requestUrl.search);

    const headers = new Headers();
    for (const name of FORWARDED_REQUEST_HEADERS) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }

    let body: ArrayBuffer | undefined;
    if (method !== "GET" && method !== "DELETE") {
      const declared = Number(request.headers.get("content-length") ?? "0");
      if (declared > MAX_BODY_BYTES) {
        return Response.json(
          { error: { code: "VALIDATION", message: "Request body too large.", requestId } },
          { status: 413 },
        );
      }

      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > MAX_BODY_BYTES) {
        return Response.json(
          { error: { code: "VALIDATION", message: "Request body too large.", requestId } },
          { status: 413 },
        );
      }
      if (buffer.byteLength > 0) body = buffer;
    }

    const upstream = await fetch(target, {
      method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });

    const responseHeaders = new Headers();
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }

    for (const cookie of upstream.headers.getSetCookie()) {
      responseHeaders.append("set-cookie", narrowSetCookie(cookie));
    }

    // The auth proxy is never cacheable.
    responseHeaders.set("cache-control", "no-store");

    log("info", "auth.proxy", {
      requestId,
      method,
      // Path only — query strings can carry tokens.
      route: `auth/${all.join("/")}`,
      status: upstream.status,
      durationMs: Date.now() - startedAt,
    });

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    log("error", "auth.proxy.failed", { requestId, method, error });
    const { body: errorBody, status } = toErrorResponse(error, requestId);
    return Response.json(errorBody, { status });
  }
}

export {
  handler as GET,
  handler as POST,
  handler as PUT,
  handler as PATCH,
  handler as DELETE,
};
