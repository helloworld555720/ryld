/**
 * Cookie passthrough helpers. The proxy may narrow cookie scope, never widen it.
 */

/**
 * Removes any `Domain` attribute and guarantees `Path=/`, preserving every other
 * attribute (`HttpOnly`, `Secure`, `SameSite`, `Max-Age`, `Expires`).
 */
export function narrowSetCookie(cookie: string): string {
  const parts = cookie
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .filter((part) => !/^domain\s*=/i.test(part));

  if (!parts.some((part) => /^path\s*=/i.test(part))) {
    parts.push("Path=/");
  }

  return parts.join("; ");
}
