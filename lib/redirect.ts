/**
 * Guards post-login redirects against open-redirect abuse.
 * Only same-origin, absolute-path targets are allowed.
 */
export function safeRedirect(
  value: string | null | undefined,
  fallback = "/",
): string {
  if (!value) return fallback;

  const trimmed = value.trim();

  // Must be an absolute path on this origin.
  if (!trimmed.startsWith("/")) return fallback;
  // Protocol-relative (//evil.test) and backslash tricks (/\evil.test).
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return fallback;
  if (trimmed.includes("\\")) return fallback;
  // No scheme, host, or whitespace/control characters.
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return fallback;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return fallback;

  return trimmed;
}
