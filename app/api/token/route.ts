import { NextResponse, type NextRequest } from "next/server";

import { getAccessToken, getSession } from "@/lib/auth/server";
import { ApiError, toErrorResponse, type ApiErrorCode } from "@/lib/errors";
import { readJwtExpiry } from "@/lib/jwt";
import { log, newRequestId } from "@/lib/log";

/**
 * Mints a short-lived JWT for the API service and gives it to an authenticated
 * user who explicitly asked for one on `/api-token`.
 *
 * This is the **one documented exception** to "the JWT never leaves the
 * server" (AGENTS.md §5.2). The guards that make it defensible:
 *
 * - `POST` only, so the token never lands in a URL, history, or prefetch.
 * - Same-origin `Origin` check on top of the `SameSite=Lax` session cookie.
 * - `cache-control: no-store`; never reachable through an RSC payload.
 * - Minted per request and never logged or persisted server-side.
 *
 * The response is the token and its expiry; the browser keeps it in memory.
 */

function sameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;

  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}

export async function POST(request: NextRequest) {
  const requestId = newRequestId();
  const startedAt = Date.now();

  const respond = (body: unknown, status: number) =>
    NextResponse.json(body, {
      status,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });

  const fail = (status: number, code?: ApiErrorCode) => {
    const { body, status: responseStatus } = toErrorResponse(
      new ApiError({ status, code, requestId }),
      requestId,
    );
    return respond(body, responseStatus);
  };

  if (!sameOrigin(request)) {
    log("warn", "token.rejected_origin", { requestId });
    return fail(403, "FORBIDDEN");
  }

  let session;
  try {
    session = await getSession();
  } catch {
    log("error", "token.session_read_failed", {
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return fail(502, "UPSTREAM");
  }

  if (!session) {
    log("warn", "token.no_session", { requestId });
    return fail(401, "UNAUTHORIZED");
  }

  try {
    const token = await getAccessToken();

    log("info", "token.minted", {
      requestId,
      durationMs: Date.now() - startedAt,
    });

    return respond({ token, expiresAt: readJwtExpiry(token) }, 200);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      log("warn", "token.session_expired", { requestId });
      return fail(401, "UNAUTHORIZED");
    }

    log("error", "token.mint_failed", {
      requestId,
      durationMs: Date.now() - startedAt,
    });
    return fail(502, "UPSTREAM");
  }
}
