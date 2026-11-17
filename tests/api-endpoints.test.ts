import { describe, expect, it } from "vitest";

import {
  BFF_ENDPOINTS,
  buildUpstreamPath,
  matchEndpoint,
} from "@/lib/api/endpoints";
import { CONNECTION_PROVIDERS } from "@/lib/connections";

describe("matchEndpoint", () => {
  it("matches the Connect anchor and records that upstream takes a POST", () => {
    const match = matchEndpoint("GET", "/connections/youtube/start");

    expect(match?.params).toEqual({ provider: "youtube" });
    expect(match?.endpoint.kind).toBe("oauth-start");
    expect(match?.endpoint.upstreamMethod).toBe("POST");
    expect(match?.endpoint.redirectHosts).toEqual(["accounts.google.com"]);
  });

  it("matches the provider callback that Google is registered to call", () => {
    const match = matchEndpoint("GET", "/oauth/youtube/callback");

    expect(match?.params).toEqual({ provider: "youtube" });
    expect(match?.endpoint.kind).toBe("oauth-complete");
    expect(buildUpstreamPath(match!)).toBe("/connections/youtube/complete");
  });

  it("derives both Google Drive paths from the provider registry", () => {
    const start = matchEndpoint("GET", "/connections/gdrive/start");

    expect(start?.params).toEqual({ provider: "gdrive" });
    expect(start?.endpoint.kind).toBe("oauth-start");
    expect(start?.endpoint.upstreamMethod).toBe("POST");
    expect(start?.endpoint.redirectHosts).toEqual(["accounts.google.com"]);
    expect(buildUpstreamPath(start!)).toBe("/connections/gdrive/start");

    const callback = matchEndpoint("GET", "/oauth/gdrive/callback");

    expect(callback?.params).toEqual({ provider: "gdrive" });
    expect(callback?.endpoint.kind).toBe("oauth-complete");
    expect(buildUpstreamPath(callback!)).toBe("/connections/gdrive/complete");
  });

  it("matches the connections list and rewrites the trailing slash", () => {
    const match = matchEndpoint("GET", "/connections");

    expect(match?.endpoint.kind).toBe("json");
    expect(match?.endpoint.response).toBeDefined();
    expect(buildUpstreamPath(match!)).toBe("/connections/");
  });

  it("matches project creation and maps it onto the upstream jobs resource", () => {
    const match = matchEndpoint("POST", "/projects");

    expect(match?.endpoint.kind).toBe("json");
    expect(match?.endpoint.request).toBeDefined();
    expect(match?.endpoint.response).toBeDefined();
    expect(buildUpstreamPath(match!)).toBe("/jobs/");
  });

  it("keeps the project path exactly POST", () => {
    expect(matchEndpoint("GET", "/projects")).toBeNull();
    expect(matchEndpoint("DELETE", "/projects")).toBeNull();
    expect(matchEndpoint("POST", "/projects/1")).toBeNull();
  });

  it("matches the Drive Picker config and access-token calls", () => {
    const config = matchEndpoint("GET", "/connections/gdrive/config");

    expect(config?.endpoint.kind).toBe("json");
    expect(config?.endpoint.response).toBeDefined();
    expect(buildUpstreamPath(config!)).toBe("/connections/gdrive/config");

    const token = matchEndpoint("POST", "/connections/gdrive/access-token");

    expect(token?.endpoint.kind).toBe("json");
    expect(token?.endpoint.request).toBeDefined();
    expect(token?.endpoint.response).toBeDefined();
    expect(buildUpstreamPath(token!)).toBe("/connections/gdrive/access-token");
  });

  it("keeps the Drive Picker calls on their exact verbs", () => {
    expect(matchEndpoint("POST", "/connections/gdrive/config")).toBeNull();
    expect(matchEndpoint("GET", "/connections/gdrive/access-token")).toBeNull();
    expect(
      matchEndpoint("DELETE", "/connections/gdrive/access-token"),
    ).toBeNull();
  });

  it("rejects a method the endpoint did not register", () => {
    expect(matchEndpoint("POST", "/connections/youtube/start")).toBeNull();
    expect(matchEndpoint("POST", "/oauth/youtube/callback")).toBeNull();
    expect(matchEndpoint("TRACE", "/connections")).toBeNull();
  });

  it("rejects providers that are not in the registry", () => {
    expect(matchEndpoint("GET", "/connections/vimeo/start")).toBeNull();
    expect(matchEndpoint("GET", "/oauth/vimeo/callback")).toBeNull();
  });

  it("rejects unknown paths", () => {
    expect(matchEndpoint("GET", "/admin")).toBeNull();
    expect(matchEndpoint("GET", "/connect/youtube")).toBeNull();
    expect(matchEndpoint("GET", "/connections/youtube")).toBeNull();
    expect(matchEndpoint("GET", "/connections/youtube/complete")).toBeNull();
  });

  it("rejects traversal, encoding, and absolute URLs", () => {
    for (const path of [
      "/connections/../admin/start",
      "/connections/%2e%2e/start",
      "/connections/youtube/start/",
      "/connections//start",
      "//connections/youtube/start",
      "http://localhost:8000/connections/youtube/start",
      "/connections/youtube/start?x=1",
      "/oauth/../callback",
    ]) {
      expect(matchEndpoint("GET", path)).toBeNull();
    }
  });

  it("is case-sensitive", () => {
    expect(matchEndpoint("GET", "/Connections/youtube/start")).toBeNull();
    expect(matchEndpoint("GET", "/connections/YouTube/start")).toBeNull();
  });
});

describe("BFF_ENDPOINTS", () => {
  it("derives every provider param from the provider registry", () => {
    const ids = CONNECTION_PROVIDERS.map((provider) => provider.id);

    for (const endpoint of BFF_ENDPOINTS) {
      for (const value of endpoint.params?.provider ?? []) {
        expect(ids).toContain(value);
      }
    }
  });

  it("gives every redirect endpoint an explicit host allowlist", () => {
    const redirecting = BFF_ENDPOINTS.filter(
      (endpoint) => endpoint.kind === "oauth-start",
    );

    expect(redirecting.length).toBe(CONNECTION_PROVIDERS.length);
    for (const endpoint of redirecting) {
      expect(endpoint.redirectHosts?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("gives every json endpoint a response schema", () => {
    for (const endpoint of BFF_ENDPOINTS) {
      if (endpoint.kind === "json") expect(endpoint.response).toBeDefined();
    }
  });

  it("exposes exactly two browser paths per provider", () => {
    const patterns = BFF_ENDPOINTS.filter(
      (endpoint) => endpoint.params?.provider,
    ).map((endpoint) => endpoint.pattern);

    expect(patterns).toContain("/connections/:provider/start");
    expect(patterns).toContain("/oauth/:provider/callback");
    expect(patterns).toHaveLength(CONNECTION_PROVIDERS.length * 2);
  });
});
