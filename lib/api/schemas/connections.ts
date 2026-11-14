import { z } from "zod";

/**
 * Upstream payloads for the connections API. Deliberately loose where the
 * contract is not verified — see `docs/api-inventory.md`.
 */

/**
 * `GET /connections/`. The list is `[]` until a real consent completes, so the
 * item shape has never been observed. Only "is a JSON array" is enforced for
 * now; tighten this the first time a populated response is captured.
 */
export const connectionsListSchema = z.array(z.unknown());

/**
 * `POST /connections/:provider/complete` → `{ "connected": false }` for every
 * failure, `{ "connected": true }` on success (assumed; unobserved). Extra keys
 * are allowed so upstream can add account metadata without breaking us.
 */
export const completeResultSchema = z
  .object({ connected: z.boolean() })
  .catchall(z.unknown());

export type CompleteResult = z.infer<typeof completeResultSchema>;
