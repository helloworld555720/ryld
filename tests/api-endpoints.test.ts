import { describe, expect, it } from "vitest";

import {
  BFF_ENDPOINTS,
  buildUpstreamPath,
  matchEndpoint,
} from "@/lib/api/endpoints";

describe("matchEndpoint", () => {
  it("matches a registered connect path and exposes its provider", () => {
    const match = matchEndpoint("GET", "/connect/youtube");

    expect(match?.params).toEqual({ provider: "youtube" });
    expect(match?.endpoint.redirectHosts).toEqual(["accounts.google.com"]);
  });

  it("rejects a method the endpoint did not register", () => {
    expect(matchEndpoint("POST", "/connect/youtube")).toBeNull();
    expect(matchEndpoint("TRACE", "/connect/youtube")).toBeNull();
  });

  it("rejects providers that are not in the registry", () => {
    expect(matchEndpoint("GET", "/connect/vimeo")).toBeNull();
  });

  it("rejects unknown paths", () => {
    expect(matchEndpoint("GET", "/admin")).toBeNull();
    expect(matchEndpoint("GET", "/connect")).toBeNull();
  });

  it("rejects traversal, encoding, and absolute URLs", () => {
    for (const path of [
      "/connect/../admin",
      "/connect/%2e%2e/youtube",
      "/connect/youtube/",
      "/connect//youtube",
      "//connect/youtube",
      "http://localhost:8000/connect/youtube",
      "/connect/youtube?x=1",
    ]) {
      expect(matchEndpoint("GET", path)).toBeNull();
    }
  });

  it("is case-sensitive", () => {
    expect(matchEndpoint("GET", "/CONNECT/youtube")).toBeNull();
    expect(matchEndpoint("GET", "/connect/YouTube")).toBeNull();
  });

  it("builds the upstream path from the registry, not raw input", () => {
    const match = matchEndpoint("GET", "/connect/youtube");
    expect(match).not.toBeNull();
    expect(buildUpstreamPath(match!)).toBe("/connect/youtube");
  });
});

describe("BFF_ENDPOINTS", () => {
  it("scopes every endpoint to explicit params and redirect hosts", () => {
    expect(BFF_ENDPOINTS.length).toBeGreaterThan(0);

    for (const endpoint of BFF_ENDPOINTS) {
      expect(endpoint.redirectHosts?.length ?? 0).toBeGreaterThan(0);
      expect(Object.keys(endpoint.params ?? {}).length).toBeGreaterThan(0);

      for (const values of Object.values(endpoint.params ?? {})) {
        expect(values.length).toBeGreaterThan(0);
      }
    }
  });
});
