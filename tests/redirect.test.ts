import { describe, expect, it } from "vitest";

import { safeRedirect } from "@/lib/redirect";

describe("safeRedirect", () => {
  it("falls back when the value is missing", () => {
    expect(safeRedirect(null)).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
    expect(safeRedirect("")).toBe("/");
  });

  it("keeps same-origin absolute paths", () => {
    expect(safeRedirect("/dashboard")).toBe("/dashboard");
    expect(safeRedirect("/items/42?tab=history")).toBe("/items/42?tab=history");
    expect(safeRedirect("/a/b#section")).toBe("/a/b#section");
  });

  it("rejects absolute URLs and schemes", () => {
    expect(safeRedirect("https://evil.example")).toBe("/");
    expect(safeRedirect("javascript:alert(1)")).toBe("/");
    expect(safeRedirect("data:text/html,hi")).toBe("/");
  });

  it("rejects protocol-relative and backslash tricks", () => {
    expect(safeRedirect("//evil.example")).toBe("/");
    expect(safeRedirect("/\\evil.example")).toBe("/");
    expect(safeRedirect("/a\\b")).toBe("/");
    expect(safeRedirect("\\/evil.example")).toBe("/");
  });

  it("rejects control characters and normalises surrounding whitespace", () => {
    expect(safeRedirect("/ok\nLocation: https://evil.example")).toBe("/");
    expect(safeRedirect(" /dashboard")).toBe("/dashboard");
    expect(safeRedirect("\t/dashboard")).toBe("/dashboard");
  });

  it("honours a custom fallback", () => {
    expect(safeRedirect("https://evil.example", "/home")).toBe("/home");
  });
});
