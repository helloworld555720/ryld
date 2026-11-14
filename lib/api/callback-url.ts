/**
 * The `redirect_uri` we hand the API and that the provider redirects back to.
 *
 * It must be byte-identical on both hops — start and complete — because the
 * API forwards it to the provider and the provider rejects a mismatch. It is
 * also validated against the API's allowlist, so a wrong value fails closed
 * with a 400 rather than sending the browser somewhere unexpected.
 */
export function buildCallbackUrl(origin: string, providerId: string): string {
  return new URL(
    `/api/backend/oauth/${encodeURIComponent(providerId)}/callback`,
    origin,
  ).toString();
}
