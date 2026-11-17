import { describe, expect, it } from "vitest";

import {
  completeResultSchema,
  connectionsListSchema,
  gdriveAccessTokenRequestSchema,
  gdriveAccessTokenSchema,
  gdriveConfigSchema,
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

describe("gdriveConfigSchema", () => {
  it("accepts the payload the API returned and stringifies the project number", () => {
    const parsed = gdriveConfigSchema.parse({
      api_key: "AIzaSyCcGTtEM-9NVSs5v8jbfEvNvlu-u945iG4",
      project_number: 801901239085,
    });

    expect(parsed.project_number).toBe("801901239085");
  });

  it("rejects a payload with no API key", () => {
    expect(gdriveConfigSchema.safeParse({ project_number: 1 }).success).toBe(
      false,
    );
    expect(
      gdriveConfigSchema.safeParse({ api_key: "", project_number: 1 }).success,
    ).toBe(false);
  });
});

describe("gdriveAccessTokenRequestSchema", () => {
  it("requires a UUID connection id", () => {
    expect(
      gdriveAccessTokenRequestSchema.safeParse({
        conn_id: "23d7949e-0f85-4a64-ab5b-a855e39fc3b5",
      }).success,
    ).toBe(true);
    expect(gdriveAccessTokenRequestSchema.safeParse({}).success).toBe(false);
    expect(
      gdriveAccessTokenRequestSchema.safeParse({ conn_id: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(
      gdriveAccessTokenRequestSchema.safeParse({ conn_id: 42 }).success,
    ).toBe(false);
  });
});

describe("gdriveAccessTokenSchema", () => {
  it("accepts the shape the API returned", () => {
    expect(
      gdriveAccessTokenSchema.parse({ access_token: "ya29.a0Aehf…" }),
    ).toEqual({ access_token: "ya29.a0Aehf…" });
  });

  it("rejects a response with no token", () => {
    expect(gdriveAccessTokenSchema.safeParse({}).success).toBe(false);
    expect(
      gdriveAccessTokenSchema.safeParse({ access_token: "" }).success,
    ).toBe(false);
  });
});
