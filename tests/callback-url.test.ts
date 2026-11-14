import { describe, expect, it } from "vitest";

import { buildCallbackUrl } from "@/lib/api/callback-url";

describe("buildCallbackUrl", () => {
  it("builds the URL the API and Google must both be registered against", () => {
    expect(buildCallbackUrl("http://localhost:3000", "youtube")).toBe(
      "http://localhost:3000/api/backend/oauth/youtube/callback",
    );
  });

  it("keeps the origin's scheme and port", () => {
    expect(buildCallbackUrl("https://app.example.com", "youtube")).toBe(
      "https://app.example.com/api/backend/oauth/youtube/callback",
    );
    expect(buildCallbackUrl("http://localhost:3111", "youtube")).toBe(
      "http://localhost:3111/api/backend/oauth/youtube/callback",
    );
  });

  it("encodes the provider segment so it cannot escape the path", () => {
    expect(buildCallbackUrl("http://localhost:3000", "../admin")).toBe(
      "http://localhost:3000/api/backend/oauth/..%2Fadmin/callback",
    );
  });
});
