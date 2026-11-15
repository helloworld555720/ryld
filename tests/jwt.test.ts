import { describe, expect, it } from "vitest";

import { readJwtExpiry } from "@/lib/jwt";

function makeToken(payload: unknown): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");

  return `${encode({ alg: "EdDSA", typ: "JWT" })}.${encode(payload)}.signature`;
}

describe("readJwtExpiry", () => {
  it("returns the ISO expiry from the exp claim", () => {
    expect(readJwtExpiry(makeToken({ exp: 1_800_000_000 }))).toBe(
      new Date(1_800_000_000_000).toISOString(),
    );
  });

  it("returns null for a malformed token", () => {
    expect(readJwtExpiry("not-a-jwt")).toBeNull();
    expect(readJwtExpiry("header.%%%.signature")).toBeNull();
  });

  it("returns null when exp is missing or not a number", () => {
    expect(readJwtExpiry(makeToken({ sub: "user" }))).toBeNull();
    expect(readJwtExpiry(makeToken({ exp: "1800000000" }))).toBeNull();
  });
});
