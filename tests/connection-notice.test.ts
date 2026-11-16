import { describe, expect, it } from "vitest";

import { connectionNotice } from "@/lib/connection-notice";

describe("connectionNotice", () => {
  it("names the provider on success", () => {
    expect(connectionNotice({ connected: "youtube" })).toEqual({
      tone: "success",
      message: "YouTube is connected.",
    });
  });

  it("ignores unknown provider ids", () => {
    expect(connectionNotice({ connected: "evil" })).toBeNull();
  });

  it("maps cancellation and expiry to fixed copy", () => {
    expect(connectionNotice({ error: "access_denied" })?.message).toBe(
      "Authorization was cancelled. Nothing was changed.",
    );
    expect(connectionNotice({ error: "session_expired" })?.tone).toBe("error");
  });

  it("maps provider failure slugs", () => {
    expect(connectionNotice({ error: "youtube_failed" })?.message).toBe(
      "We couldn't finish connecting YouTube. Please try again.",
    );
    expect(connectionNotice({ error: "youtube_start_failed" })?.tone).toBe(
      "error",
    );
  });

  it("never echoes an attacker-controlled value", () => {
    const attack = "<img src=x onerror=alert(1)>";
    const notice = connectionNotice({ error: attack });
    expect(notice?.message).toBe(
      "We couldn't finish that connection. Please try again.",
    );
    expect(notice?.message).not.toContain(attack);
  });

  it("returns null when there is no status flag", () => {
    expect(connectionNotice({})).toBeNull();
  });
});
