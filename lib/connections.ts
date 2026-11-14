import { SquarePlay, type LucideIcon } from "lucide-react";

/**
 * Connection providers the UI offers. Client-safe: no URLs, no secrets.
 *
 * Adding a provider is three steps: an entry here, a matching BFF entry in
 * `lib/api/endpoints.ts`, and the provider's OAuth credentials on the API
 * service. The BFF rejects any provider not listed here.
 */
export interface ConnectionProvider {
  /** Also the upstream path segment: `/connections/<id>/*`. */
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Which site the user is sent to for consent, for the card copy. */
  consentHost: string;
  /**
   * OIDC issuer for this provider. The API requires an `iss` on completion but
   * the provider only sends one on OpenID Connect callbacks, so the BFF
   * supplies this value when the callback omits it.
   */
  issuer: string;
  /**
   * Hosts the API is allowed to redirect to for this provider. The BFF refuses
   * any `Location` outside this list, so a compromised upstream cannot bounce
   * users to an arbitrary origin with our domain in the referrer.
   */
  allowedRedirectHosts: readonly string[];
}

export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = [
  {
    id: "youtube",
    label: "YouTube",
    description:
      "Authorize Ryld to access your YouTube account and channel data.",
    icon: SquarePlay,
    consentHost: "Google",
    issuer: "https://accounts.google.com",
    allowedRedirectHosts: ["accounts.google.com"],
  },
];

export function getConnectionProvider(
  id: string,
): ConnectionProvider | undefined {
  return CONNECTION_PROVIDERS.find((provider) => provider.id === id);
}
