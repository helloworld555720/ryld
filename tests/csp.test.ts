import { describe, expect, it } from "vitest";

import { buildCsp, mediaOriginOf, newNonce } from "@/lib/csp";

function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `) || part === name);
  return found ?? "";
}

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc123", isDev: false });
  const dev = buildCsp({ nonce: "abc123", isDev: true });

  it("locks scripts to the nonce and strict-dynamic", () => {
    const script = directive(prod, "script-src");
    expect(script).toContain("'nonce-abc123'");
    expect(script).toContain("'strict-dynamic'");
  });

  it("never allows inline or eval scripts in production", () => {
    const script = directive(prod, "script-src");
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it("allows 'unsafe-eval' only in development (React debugging)", () => {
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
  });

  it("allows inline styles for Radix positioning, but no nonce there", () => {
    const style = directive(prod, "style-src");
    expect(style).toContain("'unsafe-inline'");
    expect(style).not.toContain("nonce");
  });

  it("does not let any origin but the Picker be framed", () => {
    expect(directive(prod, "frame-src")).toBe("frame-src https://docs.google.com");
  });

  it("allows no wildcard and no remote origin except the Picker frame", () => {
    expect(prod).not.toContain("*");
    const origins = prod.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(origins).toEqual(["https://docs.google.com"]);
  });

  it("keeps playback off the policy until a media host exists", () => {
    expect(directive(prod, "media-src")).toBe("media-src 'self' blob:");
    expect(directive(prod, "img-src")).not.toContain("http");
  });

  it("allows exactly the configured media origin for playback", () => {
    const withMedia = buildCsp({
      nonce: "abc123",
      isDev: false,
      mediaOrigins: ["https://media.example.com"],
    });

    for (const name of ["img-src", "media-src", "connect-src"]) {
      expect(directive(withMedia, name), name).toContain(
        "https://media.example.com",
      );
    }

    // MSE and hls.js need blob: media and a blob worker.
    expect(directive(withMedia, "media-src")).toContain("blob:");
    expect(directive(withMedia, "worker-src")).toContain("blob:");

    const origins = withMedia.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(origins)).toEqual(
      new Set(["https://docs.google.com", "https://media.example.com"]),
    );
  });

  it("allows a separate segment origin for playback", () => {
    const both = buildCsp({
      nonce: "abc123",
      isDev: false,
      mediaOrigins: ["https://media.example.com", "https://segments.example.com"],
    });

    for (const name of ["media-src", "connect-src"]) {
      expect(directive(both, name), name).toContain("https://media.example.com");
      expect(directive(both, name), name).toContain(
        "https://segments.example.com",
      );
    }

    const origins = both.match(/https?:\/\/[^\s;]+/g) ?? [];
    expect(new Set(origins)).toEqual(
      new Set([
        "https://docs.google.com",
        "https://media.example.com",
        "https://segments.example.com",
      ]),
    );
  });

  it("does not repeat an origin configured for both hosts", () => {
    const same = buildCsp({
      nonce: "abc123",
      isDev: false,
      mediaOrigins: [
        "https://media.example.com",
        "https://media.example.com",
      ],
    });

    expect(directive(same, "connect-src")).toBe(
      "connect-src 'self' https://media.example.com",
    );
  });

  it("blocks framing, objects, and base/form hijacking", () => {
    expect(directive(prod, "frame-ancestors")).toContain("'none'");
    expect(directive(prod, "object-src")).toContain("'none'");
    expect(directive(prod, "base-uri")).toContain("'self'");
    expect(directive(prod, "form-action")).toContain("'self'");
  });

  it("keeps the browser same-origin, with HMR websockets only in dev", () => {
    expect(directive(prod, "connect-src")).toBe("connect-src 'self'");
    expect(directive(dev, "connect-src")).toContain("ws:");
  });

  it("upgrades insecure requests in production only (dev is plain http)", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("does not leave empty directives", () => {
    expect(prod).not.toMatch(/;\s*;/);
    expect(prod.endsWith(";")).toBe(false);
  });
});

describe("mediaOriginOf", () => {
  it("reduces a configured base to its origin", () => {
    expect(mediaOriginOf("https://media.example.com/bucket")).toBe(
      "https://media.example.com",
    );
    expect(mediaOriginOf("http://localhost:9000/ryld")).toBe(
      "http://localhost:9000",
    );
  });

  it("returns null for nothing usable, so the policy gains no origin", () => {
    expect(mediaOriginOf(undefined)).toBeNull();
    expect(mediaOriginOf("")).toBeNull();
    expect(mediaOriginOf("media.example.com")).toBeNull();
    expect(mediaOriginOf("ftp://media.example.com")).toBeNull();
  });
});

describe("newNonce", () => {
  it("is unpredictable and unique per call", () => {
    const values = new Set(Array.from({ length: 50 }, () => newNonce()));
    expect(values.size).toBe(50);
    for (const value of values) {
      expect(value).toMatch(/^[A-Za-z0-9+/=]+$/);
      expect(value.length).toBeGreaterThanOrEqual(20);
    }
  });
});
