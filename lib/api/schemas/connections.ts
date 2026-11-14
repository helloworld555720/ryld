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
 * `POST /connections/:provider/complete` → `{ "connected": false }` for every
 * failure, `{ "connected": true }` on success (assumed; unobserved).
 */
export const completeResultSchema = z
  .object({ connected: z.boolean() })
  .catchall(z.unknown());

export type CompleteResult = z.infer<typeof completeResultSchema>;
