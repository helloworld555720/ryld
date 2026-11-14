import "server-only";

import type { ZodType } from "zod";

import { connectionsListSchema } from "@/lib/api/schemas/connections";
import { CONNECTION_PROVIDERS } from "@/lib/connections";

/**
 * The BFF allowlist. Deny by default: a request is forwarded to the API
 * service only if method + path match an entry here. Nothing is inferred from
 * the URL, and `:params` are validated against literal values — never passed
 * through as free-form input.
 *
 * Every entry names the browser-facing call *and* the upstream call. They are
 * not always the same verb: the cards are plain anchors (a GET navigation), so
 * `oauth-start` receives a GET and issues a POST upstream.
 *
 * See AGENTS.md §5.4 (open proxy / SSRF).
 */
export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;

export type HttpMethod = (typeof HTTP_METHODS)[number];

/**
 * How the handler treats the upstream answer:
 * - `json` — upstream returns JSON, validated against `response` and relayed.
 * - `oauth-start` — upstream returns a 3xx to the consent screen; host-checked,
 *   relayed to the browser as a 303.
 * - `oauth-complete` — upstream returns `{ connected }`; the handler turns it
 *   into a 303 back to `/connections` (a top-level navigation must never end
 *   on a JSON body).
 */
export type EndpointKind = "json" | "oauth-start" | "oauth-complete";

export interface EndpointEntry {
  id: string;
  kind: EndpointKind;
  /** Browser-facing method and path under `/api/backend`. */
  method: HttpMethod;
  pattern: string;
  /** Upstream verb, when it differs from the browser-facing one. */
  upstreamMethod?: HttpMethod;
  /** Upstream path, when it differs from `pattern`. Supports `:params`. */
  upstreamPath?: string;
  /** Allowed values for each `:param`. A param not listed here never matches. */
  params?: Record<string, readonly string[]>;
  /**
   * External hosts this endpoint's upstream 3xx may point at. Empty means the
   * BFF will refuse to follow it. Always scoped per entry, never a union of
   * all providers, so one provider cannot redirect through another's host.
   */
  redirectHosts?: readonly string[];
  /** Required for `json`: the upstream payload must parse against this. */
  response?: ZodType;
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

/** Both OAuth hops exist per provider, generated from the registry. */
const connectionEntries = CONNECTION_PROVIDERS.flatMap(
  (provider): EndpointEntry[] => [
    {
      id: `connections.start:${provider.id}`,
      kind: "oauth-start",
      method: "GET",
      pattern: "/connections/:provider/start",
      params: { provider: [provider.id] },
      upstreamMethod: "POST",
      redirectHosts: provider.allowedRedirectHosts,
    },
    {
      id: `connections.callback:${provider.id}`,
      kind: "oauth-complete",
      method: "GET",
      pattern: "/oauth/:provider/callback",
      params: { provider: [provider.id] },
      upstreamMethod: "POST",
      upstreamPath: "/connections/:provider/complete",
    },
  ],
);

export const BFF_ENDPOINTS: readonly EndpointEntry[] = [
  {
    id: "connections.list",
    kind: "json",
    method: "GET",
    pattern: "/connections",
    // The upstream route only resolves with the trailing slash.
    upstreamPath: "/connections/",
    response: connectionsListSchema,
  },
  ...connectionEntries,
];

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
 * Rebuilds the upstream path from the registry, not from the incoming request.
 * The values are already allowlisted; encoding is belt and braces.
 */
export function buildUpstreamPath(match: EndpointMatch): string {
  const template = match.endpoint.upstreamPath ?? match.endpoint.pattern;

  return template.replace(/:([a-zA-Z]+)/g, (_match, name: string) =>
    encodeURIComponent(match.params[name] ?? ""),
  );
}
