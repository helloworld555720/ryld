import { describe, expect, it } from "vitest";

import { narrowSetCookie } from "@/lib/auth/cookies";

describe("narrowSetCookie", () => {
  it("strips a Domain attribute so cookies stay first-party", () => {
    const result = narrowSetCookie(
      "better-auth.session_token=abc123; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax; Domain=auth.example.com",
    );
    expect(result).not.toMatch(/domain/i);
    expect(result).toContain("better-auth.session_token=abc123");
    expect(result).toContain("HttpOnly");
    expect(result).toContain("SameSite=Lax");
  });

  it("adds Path=/ when the upstream omitted it", () => {
    expect(narrowSetCookie("session=abc; HttpOnly")).toBe("session=abc; HttpOnly; Path=/");
  });

  it("preserves Expires values containing commas", () => {
    const result = narrowSetCookie(
      "session=abc; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Domain=example.com; Secure",
    );
    expect(result).toContain("Expires=Wed, 21 Oct 2026 07:28:00 GMT");
    expect(result).toContain("Secure");
    expect(result).not.toMatch(/domain/i);
  });

  it("never adds Secure or relaxes SameSite", () => {
    const result = narrowSetCookie("session=abc");
    expect(result).not.toMatch(/secure/i);
    expect(result).not.toMatch(/samesite/i);
  });
});
