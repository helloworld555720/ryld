import "server-only";

import {
  connectionsListSchema,
  type Connection,
} from "@/lib/api/schemas/connections";
import { getAccessToken } from "@/lib/auth/server";
import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";

const TIMEOUT_MS = 10_000;

/**
 * The caller's connections, for first paint.
 *
 * Server component path: no HTTP hop back through our own BFF, and the JWT is
 * minted and dropped inside this call. Throws `ApiError` rather than
 * swallowing, so the caller decides how visible the failure should be — a
 * connection list is not worth failing the whole page.
 */
export async function listConnections(): Promise<Connection[]> {
  const token = await getAccessToken();
  const { API_URL } = getServerEnv();

  const response = await fetch(`${API_URL}/connections/`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ApiError({
      status: 502,
      code: "UPSTREAM",
      detail: `connections list responded ${response.status}`,
    });
  }

  const payload: unknown = await response.json().catch(() => null);
  const parsed = connectionsListSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError({
      status: 502,
      code: "UPSTREAM",
      detail: "connections list returned an unexpected shape",
    });
  }

  return parsed.data;
}
