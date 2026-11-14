/**
 * Validates an upstream `Location` before the BFF hands it to the browser.
 *
 * Without this, a compromised or misconfigured API could turn the Connect
 * endpoint into an open redirect on our own origin — the kind of bug that makes
 * phishing links look trustworthy.
 */
const MAX_LENGTH = 8_192;

export function isAllowedExternalRedirect(
  location: string,
  allowedHosts: readonly string[],
): boolean {
  if (allowedHosts.length === 0) return false;
  if (location.length === 0 || location.length > MAX_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return false;
  }

  // Consent screens are always HTTPS on the default port. Reject credentials
  // so the visible host cannot differ from the one actually connected to, and
  // reject non-default ports so the host allowlist cannot be stretched.
  if (url.protocol !== "https:") return false;
  if (url.port !== "") return false;
  if (url.username !== "" || url.password !== "") return false;

  // Exact host match: `accounts.google.com.evil.test` and a trailing dot are
  // both rejected. Subdomains are never implied — list them explicitly.
  return allowedHosts.some(
    (host) => url.hostname.toLowerCase() === host.toLowerCase(),
  );
}
