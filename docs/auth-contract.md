# Auth service contract (verified)

Probed 2026-11-13 against the local dev instance. Re-verify before production; record
production values in the same table.

## Instance

| Fact | Value |
| --- | --- |
| Base URL (dev) | `http://localhost:8080` |
| Base path | `/api/auth` |
| Transport (dev) | plain HTTP |
| Health | `GET /api/auth/ok` → `200 {"ok":true}` |
| Server | better-auth (JWT plugin) |

## Plugins / capability matrix

| Probe | Result | Meaning |
| --- | --- | --- |
| `GET /api/auth/jwks` | `200` `{"keys":[{"alg":"EdDSA","crv":"Ed25519","kty":"OKP",…}]}` | **JWT plugin enabled** |
| `GET /api/auth/.well-known/openid-configuration` | `404` | oidc-provider **not** mounted |
| `GET /api/auth/token` | `401 {"code":"UNAUTHORIZED"}` | Token endpoint exists, **GET only** |
| `POST /api/auth/token` | `404` (empty body) | Not routed — do not use POST |
| `POST /api/auth/sign-in/email` | `401 INVALID_EMAIL_OR_PASSWORD` | Email/password sign-in enabled |
| `POST /api/auth/sign-up/email` | `400 VALIDATION_ERROR` (name, email, password) | Sign-up enabled |
| `POST /api/auth/request-password-reset` | `400 VALIDATION_ERROR` (email) | Reset flow enabled |
| `POST /api/auth/forget-password` | `404` | Renamed endpoint — do not call |
| `GET /api/auth/list-sessions` | `401 UNAUTHORIZED` | Session management available |

## Origin / CSRF behaviour

Verified with a syntactically valid body (a bad-credentials POST):

```
POST /api/auth/sign-in/email   Origin: http://localhost:3000
→ 401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}

POST /api/auth/sign-in/email   Origin: http://evil.example
→ 403 {"message":"Invalid origin","code":"INVALID_ORIGIN"}
```

Conclusions, each of which the proxy depends on:

1. `http://localhost:3000` is in `trustedOrigins` (the Next dev origin).
2. Origin checking is **enforced** — the proxy must forward `Origin` unchanged or every
   mutation will 403.
3. The 403 arrives *after* body validation, so a malformed body masks origin failures.
   Don't use malformed probes to test CORS/CSRF.
4. Production origin must be added to `trustedOrigins` before deploy (T6.2).

## Error envelope

```json
{ "message": "Invalid email or password", "code": "INVALID_EMAIL_OR_PASSWORD" }
```

Codes seen: `UNAUTHORIZED`, `VALIDATION_ERROR`, `INVALID_ORIGIN`,
`INVALID_EMAIL_OR_PASSWORD`, `BAD_REQUEST`. `message` is developer-facing on validation
errors (`[body.email] Invalid input: …`) — never render it raw; map by `code`.

## Token flow

```ts
// server-side only
const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/token`, {
  method: "GET",
  headers: { cookie: inboundCookieHeader, accept: "application/json" },
  signal: AbortSignal.timeout(10_000),
});
// 200 → { token: "eyJ…" }   |   401 → session missing/expired
```

- No client secret, no refresh token, no code exchange.
- The `token` is a JWKS-verifiable JWT for the API service.
- Do **not** add `jwtClient()` to the browser client — the browser never mints tokens.

## Still UNKNOWN (fill on first real login)

| Fact | How to capture |
| --- | --- |
| Cookie name + attributes (`__Secure-` prefix, `Domain`, `SameSite`, `HttpOnly`, `Secure`, `Max-Age`) | `Set-Cookie` on a real sign-in, and the cookie jar after proxying |
| Session lifetime / refresh semantics | `Max-Age` on the session cookie |
| JWT `iss` / `aud` / `exp` | Decode the token payload (base64url) |
| Claims carrying roles/permissions | Same decode — needed for T5.4 |
| Rate-limit headers/thresholds | Observed during repeated sign-in attempts |

**Cookie gotcha:** if the auth service ever decides it is on HTTPS it emits
`__Secure-`-prefixed cookies, which `http://localhost` drops silently. Keep dev on HTTP,
or front the app with TLS. The proxy must strip any `Domain` attribute and force
`Path=/`; it must never widen cookie scope.

## Proxy verification (this app, 2026-11-13)

Next dev on `http://localhost:3000`, proxy at `app/api/auth/[...all]/route.ts`.

| Request through the proxy | Result | What it proves |
| --- | --- | --- |
| `GET /api/auth/ok` | `200 {"ok":true}` | path + query pass-through |
| `GET /api/auth/get-session` | `200 null` | anonymous session read works |
| `GET /api/auth/jwks` | `200` with Ed25519 key | JWT plugin reachable |
| `GET /api/auth/token` | `401 UNAUTHORIZED` | token endpoint reached, no session |
| `POST /api/auth/sign-in/email`, `Origin: localhost:3000`, bad creds | `401 INVALID_EMAIL_OR_PASSWORD` | body + `Origin` forwarded intact |
| same, `Origin: evil.example` | `403 INVALID_ORIGIN` | auth service's CSRF check is not weakened by the proxy |
| `TRACE /api/auth/*` | `405` + `Allow` | method allowlist |

Response headers on every proxied call: `cache-control: no-store`, upstream
`content-type` preserved, no CORS headers (not needed, same-origin).

**Still unverified:** the `Set-Cookie` pass-through on a successful login (needs a real
account) and therefore the final `narrowSetCookie` behaviour in the wild — unit tests cover
domain stripping and `Path=/` forcing, but not a live browser cookie jar.
