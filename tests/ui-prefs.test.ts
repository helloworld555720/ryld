import { describe, expect, it } from "vitest";

import {
  SIDEBAR_COOKIE,
  readSidebarPreference,
  serialiseSidebarPreference,
} from "@/lib/ui-prefs";

describe("readSidebarPreference", () => {
  it("treats only the explicit rail value as collapsed", () => {
    expect(readSidebarPreference("rail")).toBe("rail");
  });

  it("defaults to expanded for anything else", () => {
    expect(readSidebarPreference("expanded")).toBe("expanded");
    expect(readSidebarPreference(undefined)).toBe("expanded");
    expect(readSidebarPreference("")).toBe("expanded");
    expect(readSidebarPreference("RAIL")).toBe("expanded");
    expect(readSidebarPreference("1")).toBe("expanded");
  });
});

describe("serialiseSidebarPreference", () => {
  it("writes a path-wide, year-long, Lax cookie", () => {
    expect(serialiseSidebarPreference("rail")).toBe(
      `${SIDEBAR_COOKIE}=rail; path=/; max-age=31536000; samesite=lax`,
    );
  });

  it("adds Secure only when asked", () => {
    expect(serialiseSidebarPreference("rail", true)).toContain("; secure");
    expect(serialiseSidebarPreference("rail", false)).not.toContain("; secure");
  });

  it("is not HttpOnly — a client component has to write it", () => {
    expect(serialiseSidebarPreference("expanded").toLowerCase()).not.toContain(
      "httponly",
    );
  });
});
