import { createAuthClient } from "better-auth/react";

/**
 * Same-origin client. Defaults are exactly what the proxy provides:
 * baseURL = current origin, basePath = "/api/auth".
 *
 * No `jwtClient()`: the browser never mints a JWT. Tokens are minted
 * server-side in `lib/auth/server.ts`.
 */
export const authClient = createAuthClient();
