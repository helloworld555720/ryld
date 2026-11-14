import { describe, expect, it } from "vitest";

import {
  completeResultSchema,
  connectionsListSchema,
} from "@/lib/api/schemas/connections";

/** Captured from the live API on 2026-11-14 for a connected YouTube account. */
const REAL_PAYLOAD = [
  { id: "7eb3f330-54cf-476b-a62c-2d5676bc8a59", type: "youtube" },
];

describe("connectionsListSchema", () => {
  it("accepts the payload the API actually returned", () => {
    expect(connectionsListSchema.parse(REAL_PAYLOAD)).toEqual(REAL_PAYLOAD);
  });

  it("accepts an account with no connections", () => {
    expect(connectionsListSchema.parse([])).toEqual([]);
  });

  it("keeps fields upstream adds later", () => {
    const parsed = connectionsListSchema.parse([
      { id: "abc", type: "youtube", channelTitle: "A channel" },
    ]);

    expect(parsed[0]).toMatchObject({ channelTitle: "A channel" });
  });

  it("rejects a payload that is not an array", () => {
    expect(connectionsListSchema.safeParse({ id: "abc" }).success).toBe(false);
    expect(connectionsListSchema.safeParse(null).success).toBe(false);
  });

  it("rejects an item without the type discriminator", () => {
    expect(connectionsListSchema.safeParse([{ id: "abc" }]).success).toBe(
      false,
    );
    expect(
      connectionsListSchema.safeParse([{ id: "abc", type: "" }]).success,
    ).toBe(false);
  });
});

describe("completeResultSchema", () => {
  it("accepts both outcomes the API documents", () => {
    expect(completeResultSchema.parse({ connected: true })).toEqual({
      connected: true,
    });
    expect(completeResultSchema.parse({ connected: false })).toEqual({
      connected: false,
    });
  });

  it("tolerates extra keys", () => {
    expect(
      completeResultSchema.parse({ connected: true, account: "x" }),
    ).toMatchObject({ account: "x" });
  });

  it("rejects a missing connected flag", () => {
    expect(completeResultSchema.safeParse({}).success).toBe(false);
  });
});
