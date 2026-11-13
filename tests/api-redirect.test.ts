import { describe, expect, it } from "vitest";

import { isAllowedExternalRedirect } from "@/lib/api/redirect";

const GOOGLE = ["accounts.google.com"];

const CONSENT_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?client_id=abc.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fapi.example.test%2Foauth%2Fyoutube%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube&state=user-id&access_type=offline&prompt=consent";

describe("isAllowedExternalRedirect", () => {
  it("accepts the provider consent URL", () => {
    expect(isAllowedExternalRedirect(CONSENT_URL, GOOGLE)).toBe(true);
  });

  it("rejects plain HTTP", () => {
    expect(
      isAllowedExternalRedirect("http://accounts.google.com/o/oauth2", GOOGLE),
    ).toBe(false);
  });

  it("rejects hosts outside the allowlist", () => {
    expect(
      isAllowedExternalRedirect("https://evil.test/o/oauth2", GOOGLE),
    ).toBe(false);
  });

  it("rejects suffix tricks on an allowed host", () => {
    expect(
      isAllowedExternalRedirect(
        "https://accounts.google.com.evil.test/o/oauth2",
        GOOGLE,
      ),
    ).toBe(false);
    expect(
      isAllowedExternalRedirect("https://accounts.google.com./o/oauth2", GOOGLE),
    ).toBe(false);
  });

  it("rejects credentials that disguise the real host", () => {
    expect(
      isAllowedExternalRedirect(
        "https://accounts.google.com@evil.test/oauth2",
        GOOGLE,
      ),
    ).toBe(false);
  });

  it("rejects non-default ports on an allowed host", () => {
    expect(
      isAllowedExternalRedirect(
        "https://accounts.google.com:8443/o/oauth2",
        GOOGLE,
      ),
    ).toBe(false);
  });

  it("rejects the allowed host appearing only in a path or query", () => {
    expect(
      isAllowedExternalRedirect(
        "https://evil.test/?next=https://accounts.google.com/",
        GOOGLE,
      ),
    ).toBe(false);
  });

  it("rejects non-URL and non-HTTPS schemes", () => {
    for (const value of [
      "",
      "not a url",
      "/oauth/youtube",
      "javascript:alert(1)",
      "data:text/html,hi",
    ]) {
      expect(isAllowedExternalRedirect(value, GOOGLE)).toBe(false);
    }
  });

  it("denies everything when no hosts are configured", () => {
    expect(isAllowedExternalRedirect(CONSENT_URL, [])).toBe(false);
  });

  it("rejects absurdly long values", () => {
    const long = `https://accounts.google.com/${"a".repeat(9_000)}`;
    expect(isAllowedExternalRedirect(long, GOOGLE)).toBe(false);
  });
});
