import { HardDrive, SquarePlay, Users, type LucideIcon } from "lucide-react";

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
  /** Which tab the provider is listed under. */
  category: ConnectionCategoryId;
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

/**
 * Tabs on `/connections`. The order here is the order in the tab strip, and
 * the first entry is the default when `?tab=` is missing or invalid.
 */
export const CONNECTION_CATEGORIES = [
  {
    id: "socials",
    label: "Socials",
    description: "Accounts Ryld can read from or publish to.",
    icon: Users,
  },
  {
    id: "storage",
    label: "Storage",
    description: "Accounts Ryld can store files in.",
    icon: HardDrive,
  },
] as const;

export type ConnectionCategory = (typeof CONNECTION_CATEGORIES)[number];
export type ConnectionCategoryId = ConnectionCategory["id"];

export const CONNECTION_PROVIDERS: readonly ConnectionProvider[] = [
  {
    id: "youtube",
    label: "YouTube",
    description:
      "Authorize Ryld to access your YouTube account and channel data.",
    icon: SquarePlay,
    category: "socials",
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

export function getConnectionCategory(
  id: string,
): ConnectionCategory | undefined {
  return CONNECTION_CATEGORIES.find((category) => category.id === id);
}

/**
 * Turns an untrusted `?tab=` value into a real category. Unknown, repeated or
 * missing values fall back to the first category rather than rendering nothing
 * — the tab is presentation, not a trust boundary.
 */
export function resolveConnectionCategory(
  id: string | undefined,
): ConnectionCategory {
  if (id) {
    const category = getConnectionCategory(id);
    if (category) return category;
  }

  return CONNECTION_CATEGORIES[0];
}

export interface ProviderAccounts<T> {
  provider: ConnectionProvider;
  /** Every connection of this type, in the order the API returned them. */
  accounts: T[];
}

/**
 * Groups connections under their provider. One provider is one group no matter
 * how many accounts are attached to it: `GET /connections/` returns one item
 * per account, all sharing the same `type`, so repeated `type` values are
 * separate accounts, never overwrites.
 *
 * Every provider in the registry appears, including those with no accounts, so
 * a provider cannot silently disappear when the list fails to load. Types the
 * registry does not know are dropped instead of guessed at.
 */
export function groupConnectionsByProvider<T extends { type: string }>(
  connections: readonly T[],
): ProviderAccounts<T>[] {
  return CONNECTION_PROVIDERS.map((provider) => ({
    provider,
    accounts: connections.filter(
      (connection) => connection.type === provider.id,
    ),
  }));
}

/** Connected accounts per category, for the tab count chips. */
export function countAccountsByCategory(
  connections: readonly { type: string }[],
): Record<ConnectionCategoryId, number> {
  const counts = Object.fromEntries(
    CONNECTION_CATEGORIES.map((category) => [category.id, 0]),
  ) as Record<ConnectionCategoryId, number>;

  const categoryOf = new Map(
    CONNECTION_PROVIDERS.map((provider) => [provider.id, provider.category]),
  );

  for (const connection of connections) {
    const category = categoryOf.get(connection.type);
    if (category) counts[category] += 1;
  }

  return counts;
}
