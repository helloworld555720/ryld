import { z } from "zod";

/**
 * Upstream payloads for the connections API — see `docs/api-inventory.md`.
 */

/**
 * One item of `GET /connections/`. Verified 2026-11-14 against a real YouTube
 * connection: `{"id": "<uuid>", "type": "youtube"}`.
 *
 * `type` — not `provider` — is the discriminator; it matches
 * `ConnectionProvider.id`. `catchall` so upstream can add account metadata
 * without taking the page down.
 */
export const connectionSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
  })
  .catchall(z.unknown());

export type Connection = z.infer<typeof connectionSchema>;

export const connectionsListSchema = z.array(connectionSchema);

/**
 * `GET /connections/gdrive/config` — the Picker's public credentials, verified
 * 2026-11-17: `{"api_key":"AIza…","project_number":801901239085}`. The project
 * number is used as the Picker `appId`; it arrives as a JSON number, so it is
 * normalised to a string for the client.
 */
export const gdriveConfigSchema = z
  .object({
    api_key: z.string().min(1),
    project_number: z
      .union([z.string().min(1), z.number()])
      .transform((value) => String(value)),
  })
  .catchall(z.unknown());

export type GdriveConfig = z.infer<typeof gdriveConfigSchema>;

/**
 * `POST /connections/gdrive/access-token` takes the connection to read from.
 * `conn_id` must be a UUID, so a connection id from another user (or another
 * provider) cannot be probed through us.
 */
export const gdriveAccessTokenRequestSchema = z.object({ conn_id: z.uuid() });

/**
 * `POST /connections/gdrive/access-token` with `{"conn_id":"<uuid>"}` answers
 * `{"access_token":"ya29.…"}` (verified 2026-11-17) — a Google OAuth token for
 * the `drive.file` scope requested by `/connections/gdrive/start`. Unknown
 * connection ids answer `404`; the token is relayed to the Picker only.
 */
export const gdriveAccessTokenSchema = z
  .object({ access_token: z.string().min(1) })
  .catchall(z.unknown());

export type GdriveAccessToken = z.infer<typeof gdriveAccessTokenSchema>;

/**
 * `POST /connections/:provider/complete` → `{ "connected": false }` for every
 * failure, `{ "connected": true }` on success (assumed; unobserved).
 */
export const completeResultSchema = z
  .object({ connected: z.boolean() })
  .catchall(z.unknown());

export type CompleteResult = z.infer<typeof completeResultSchema>;
