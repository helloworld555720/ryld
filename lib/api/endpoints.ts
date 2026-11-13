import "server-only";

import { CONNECTION_PROVIDERS } from "@/lib/connections";

/**
 * The BFF allowlist. Deny by default: a request is forwarded to the API
 * service only if method + path match an entry here. Nothing is inferred from
 * the URL, and `:params` are validated against literal values — never passed
 * through as free-form input.
 *
 * See AGENTS.md §5.4 (open proxy / SSRF) and T2.2.
 */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface EndpointEntry {
  id: string;
  method: HttpMethod;
  /** `/connect/:provider` — literal segments plus named params. */
  pattern: string;
  /** Allowed values for each `:param`. A param not listed here never matches. */
  params?: Record<string, readonly string[]>;
  /**
   * External hosts this endpoint's upstream 3xx may point at. Empty means the
   * BFF will refuse to follow it. Always scoped per entry, never a union of
   * all providers, so one provider cannot redirect through another's host.
   */
  redirectHosts?: readonly string[];
}

/** Bootstrap segments only: no percent-encoding, no dots, no slashes. */
const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._~-]*$/;
const MAX_PATH_LENGTH = 1_024;

function splitPath(path: string): string[] | null {
  if (!path.startsWith("/") || path.length > MAX_PATH_LENGTH) return null;

  const segments = path.slice(1).split("/");
  // Empty segments catch `//` and trailing slashes; SEGMENT catches `..`,
  // `%2e%2e`, backslashes, and anything else that is not a plain segment.
  if (segments.some((segment) => !SEGMENT.test(segment))) return null;

  return segments;
}

export const BFF_ENDPOINTS: readonly EndpointEntry[] = CONNECTION_PROVIDERS.map(
  (provider) => ({
    id: `connections:connect:${provider.id}`,
    method: "GET",
    pattern: "/connect/:provider",
    params: { provider: [provider.id] },
    redirectHosts: provider.allowedRedirectHosts,
  }),
);

export interface EndpointMatch {
  endpoint: EndpointEntry;
  params: Record<string, string>;
}

function matchPattern(
  endpoint: EndpointEntry,
  segments: readonly string[],
): Record<string, string> | null {
  const pattern = endpoint.pattern.slice(1).split("/");
  if (pattern.length !== segments.length) return null;

  const params: Record<string, string> = {};

  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const actual = segments[index];

    if (expected.startsWith(":")) {
      const name = expected.slice(1);
      const allowed = endpoint.params?.[name];
      if (!allowed?.includes(actual)) return null;
      params[name] = actual;
      continue;
    }

    if (expected !== actual) return null;
  }

  return params;
}

export function matchEndpoint(
  method: string,
  path: string,
): EndpointMatch | null {
  if (!(HTTP_METHODS as readonly string[]).includes(method)) return null;

  const segments = splitPath(path);
  if (!segments) return null;

  for (const endpoint of BFF_ENDPOINTS) {
    if (endpoint.method !== method) continue;

    const params = matchPattern(endpoint, segments);
    if (params) return { endpoint, params };
  }

  return null;
}

/**
 * Rebuilds the upstream path from the registry pattern, not from the incoming
 * request. The values are already allowlisted; encoding is belt and braces.
 */
export function buildUpstreamPath(match: EndpointMatch): string {
  return match.endpoint.pattern.replace(/:([a-zA-Z]+)/g, (_match, name: string) =>
    encodeURIComponent(match.params[name] ?? ""),
  );
}
