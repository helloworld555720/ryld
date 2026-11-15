import "server-only";

/**
 * Reads the `exp` claim from a JWT **without verifying it**. Verification is
 * the API service's job (it checks the signature against the auth service's
 * JWKS). This exists only so the token page can tell the user when the token
 * it just minted stops working.
 *
 * Never log the token or the decoded payload.
 */
export function readJwtExpiry(token: string): string | null {
  const segments = token.split(".");
  if (segments.length !== 3) return null;

  try {
    const json = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };

    if (typeof json.exp !== "number" || !Number.isFinite(json.exp)) {
      return null;
    }

    const expiresAt = new Date(json.exp * 1_000);
    return Number.isNaN(expiresAt.getTime())
      ? null
      : expiresAt.toISOString();
  } catch {
    return null;
  }
}
