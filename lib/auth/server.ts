import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";

const TIMEOUT_MS = 10_000;

/**
 * Loose on purpose: better-auth may add fields. We only require what the UI
 * actually reads, and pass the rest through so nothing breaks on upgrade.
 *
 * Ids are UUIDv4 since the auth service switched generator on 2026-11-15
 * (verified through this app's proxy: `user.id` and `session.id` both parse as
 * `z.uuid()`). Validating them means a future format change fails closed with
 * a 502 rather than silently mis-keying identity.
 */
const sessionSchema = z.object({
  session: z
    .object({
      id: z.uuid(),
      userId: z.uuid(),
      expiresAt: z.string(),
    })
    .catchall(z.unknown()),
  user: z
    .object({
      id: z.uuid(),
      email: z.string(),
      name: z.string().optional(),
      image: z.string().nullish(),
      emailVerified: z.boolean().optional(),
    })
    .catchall(z.unknown()),
});

export type Session = z.infer<typeof sessionSchema>;

const tokenSchema = z.object({ token: z.string().min(1) });

async function authFetch(path: string): Promise<Response> {
  const cookieHeader = (await cookies()).toString();
  const { AUTH_SERVICE_URL } = getServerEnv();

  return fetch(`${AUTH_SERVICE_URL}/api/auth/${path}`, {
    method: "GET",
    headers: {
      cookie: cookieHeader,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

function upstreamFailure(path: string, status: number): ApiError {
  return new ApiError({
    status: 502,
    code: "UPSTREAM",
    detail: `auth service ${path} responded ${status}`,
  });
}

/**
 * Reads the session through the auth service. Returns null for anonymous users
 * (including an expired cookie), never throws for a normal 401.
 * Memoised per request via React `cache`.
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  const response = await (async () => {
    const { AUTH_SERVICE_URL } = getServerEnv();
    return fetch(`${AUTH_SERVICE_URL}/api/auth/get-session`, {
      method: "GET",
      headers: { cookie: cookieHeader, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  })();

  if (response.status === 401) return null;
  if (!response.ok) throw upstreamFailure("get-session", response.status);

  const payload: unknown = await response.json();
  const parsed = sessionSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError({
      status: 502,
      code: "UPSTREAM",
      detail: "auth service returned an unexpected session shape",
    });
  }

  return parsed.data;
});

export async function requireSession(
  nextPath?: string,
): Promise<Session> {
  const session = await getSession();
  if (session) return session;

  const target = nextPath
    ? `/auth/sign-in?redirectTo=${encodeURIComponent(nextPath)}`
    : "/auth/sign-in";

  redirect(target);
}

/**
 * Mints a short-lived JWT for the API service (jwt plugin).
 * Verified contract: GET only — a POST returns a bare 404.
 * The token must never be returned to the browser or logged.
 */
export const getAccessToken = cache(async (): Promise<string> => {
  const response = await authFetch("token");

  if (response.status === 401) {
    throw new ApiError({
      status: 401,
      code: "UNAUTHORIZED",
      safeMessage: "Your session has expired. Please sign in again.",
    });
  }

  if (!response.ok) throw upstreamFailure("token", response.status);

  const payload: unknown = await response.json();
  const parsed = tokenSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError({
      status: 502,
      code: "UPSTREAM",
      detail: "auth service /token did not return { token: string }",
    });
  }

  return parsed.data.token;
});
