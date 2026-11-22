import "server-only";

import {
  projectSchema,
  projectsListSchema,
  type Project,
} from "@/lib/api/schemas/projects";
import { getAccessToken } from "@/lib/auth/server";
import { getServerEnv } from "@/lib/env";
import { ApiError } from "@/lib/errors";

const TIMEOUT_MS = 10_000;

/**
 * The caller's projects, for first paint.
 *
 * Same shape as the connections read: no HTTP hop back through our own BFF, and
 * the JWT is minted and dropped inside this call. Throws `ApiError` rather than
 * swallowing, so the page decides how visible the failure should be.
 */
export async function listProjects(): Promise<Project[]> {
  const token = await getAccessToken();
  const { API_URL } = getServerEnv();

  const response = await fetch(`${API_URL}/jobs/`, {
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
      detail: `projects list responded ${response.status}`,
    });
  }

  const payload: unknown = await response.json().catch(() => null);
  const parsed = projectsListSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError({
      status: 502,
      code: "UPSTREAM",
      detail: "projects list returned an unexpected shape",
    });
  }

  return parsed.data;
}

/**
 * One project, for the detail page.
 *
 * Upstream answers `GET /jobs/{id}` with the same object the list carries, so
 * the list schema's item schema is reused. A `404` is surfaced as a 404 rather
 * than a 502: "this project is gone" is a real answer, and the page turns it
 * into `notFound()` instead of an error state.
 */
export async function getProject(id: string): Promise<Project> {
  const token = await getAccessToken();
  const { API_URL } = getServerEnv();

  const response = await fetch(`${API_URL}/jobs/${encodeURIComponent(id)}`, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (response.status === 404) {
    throw new ApiError({
      status: 404,
      code: "NOT_FOUND",
      detail: "project not found",
    });
  }

  if (!response.ok) {
    throw new ApiError({
      status: 502,
      code: "UPSTREAM",
      detail: `project responded ${response.status}`,
    });
  }

  const payload: unknown = await response.json().catch(() => null);
  const parsed = projectSchema.safeParse(payload);

  if (!parsed.success) {
    throw new ApiError({
      status: 502,
      code: "UPSTREAM",
      detail: "project returned an unexpected shape",
    });
  }

  return parsed.data;
}
