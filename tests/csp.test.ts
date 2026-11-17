import { describe, expect, it } from "vitest";

import { buildCsp, newNonce } from "@/lib/csp";

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
