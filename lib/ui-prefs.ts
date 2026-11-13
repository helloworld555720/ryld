/**
 * Small UI preferences that must survive a full page load. They are stored in
 * cookies (not localStorage) so the server can render the first paint in the
 * right state — no flash, no hydration mismatch.
 *
 * This cookie is NOT a credential: it is readable by JS on purpose, since the
 * toggle lives in a client component. Never store anything sensitive here.
 */
export const SIDEBAR_COOKIE = "ryld_sidebar";

export type SidebarPreference = "expanded" | "rail";

export function readSidebarPreference(
  value: string | undefined,
): SidebarPreference {
  return value === "rail" ? "rail" : "expanded";
}

/**
 * One year, path-wide, Lax. `secure` follows the page protocol so production
 * keeps the attribute without breaking plain-HTTP local development.
 */
export function serialiseSidebarPreference(
  preference: SidebarPreference,
  secure = false,
): string {
  const maxAge = 60 * 60 * 24 * 365;
  const attributes = ["path=/", `max-age=${maxAge}`, "samesite=lax"];

  if (secure) attributes.push("secure");

  return `${SIDEBAR_COOKIE}=${preference}; ${attributes.join("; ")}`;
}
