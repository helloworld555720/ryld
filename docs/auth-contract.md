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

## Verified on a real sign-in (2026-11-13, direct to `:8080`)

| Fact | Observed |
| --- | --- |
| Cookie name | `better-auth.session_token` (no `__Secure-` prefix on HTTP) |
| Cookie attributes | `Max-Age=604800` (7 days), `Path=/`, `HttpOnly`, `SameSite=Lax`; **no `Domain`**, **no `Secure`** on plain HTTP |
| Session lifetime | 7 days, sliding (no refresh token, no rotation endpoint in use) |
| JWT claims | `{ iat, email, email_verified, sub, exp, iss, aud }` — `iss=http://localhost:8080`, `aud=main-api`, `exp` = `iat + 900` (15 min) |
| Role/permission claims | **none** — RBAC is not in the token; T5.4 needs a separate source |
| Sign-in response body | `{ redirect: false, token: "<session token>", user: {...} }` — note `token` is the *session* token, not a JWT |
| Rate limiting | present: repeated `sign-in/email` attempts return `429` (no `RateLimit-*` headers observed) |
| `POST /delete-user` | `404` even with a valid session — endpoint is disabled (`user.deleteUser.enabled: false`) |

## Duplicate accounts: **rejected, but disguised as success** (verified 2026-11-13)

> Correction to an earlier reading: three sign-ups for the same email returned `200` with three
> distinct ids, which looked like three users. The database has **one** row. Better-auth was
> rejecting the duplicates all along and answering with a fabricated user — an anti-enumeration
> measure. The API response cannot tell you whether an account exists; only the DB can.

The mechanism (`better-auth/dist/api/routes/sign-up.mjs:155`):

```js
const shouldReturnGenericDuplicateResponse =
  ctx.context.options.emailAndPassword.requireEmailVerification ||
  ctx.context.options.emailAndPassword.autoSignIn === false;

const dbUser = await ctx.context.internalAdapter.findUserByEmail(normalizedEmail);
if (dbUser?.user) {
  if (shouldReturnGenericDuplicateResponse) return buildGenericDuplicateResponse(); // 200, no write
  throw APIError.from("UNPROCESSABLE_ENTITY", BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL);
}
```

`buildGenericDuplicateResponse()` (`:159`) invents an id, sets `createdAt`/`updatedAt` to *now*,
returns `token: null`, and writes nothing. A unique-constraint violation on a racing insert is
masked the same way (`:233`), so the DB is the only source of truth.

| Attempt | Response | Persisted? |
| --- | --- | --- |
| 1 (lowercase) | `200`, `id=FK2lcG4YVOqtxcxE4X75sjBZP71CyEEm`, `token: null` | **yes** — the only row |
| 2 (identical body, ~1.3 s later) | `200`, `id=2KfCOFG83d8DXLDmG9NlsMaSEBWQhJE4`, `token: null` | no — synthetic |
| 3 (uppercase body) | `200`, `id=uvXU21uEXcRrySz6CZbV840fhfROywBi`, `token: null` | no — synthetic |

Tells that were already in the capture: all three responses were exactly 242 bytes, every
`createdAt` equalled its request time, `token` was `null` even on the real creation, and **no
`Set-Cookie` was ever returned**. A real sign-up that auto-signed-in would set a session cookie.

Which flag is set, and which is not:

- `requireEmailVerification` is **off**. Sign-in enforces it (`sign-in.mjs:338`), and a `200` +
  session cookie was returned for `emailVerified: false`; the JWT carried `email_verified: false`.
- Therefore `autoSignIn: false` is what makes the duplicate response generic. It also explains
  `token: null` on the successful sign-up: a new account must sign in explicitly.

**Still a real finding:** unverified accounts are fully usable (`requireEmailVerification` off).
Whether that is a bug depends on policy — see below. Rate limiting is enabled (`429` observed).

**Verify the invariant directly** (do this instead of trusting the API response):

```sql
SELECT id, email, email_verified, created_at
FROM "user" WHERE email = 'probe-dup-20261113220820@example.com';   -- expect exactly 1

SELECT indexname, indexdef FROM pg_indexes
WHERE tablename = 'user' AND indexdef ILIKE '%email%';              -- expect a UNIQUE index
```

## Hardening options — auth service (policy choices, not bug fixes)

Nothing here is required to stop duplicates; that already holds. Pick by policy:

1. **Keep the generic duplicate response.** It is deliberate: without it, sign-up becomes an
   account-existence oracle. Do not "improve" it into `USER_ALREADY_EXISTS` on a shared service.
   If you want the notification, use `emailAndPassword.onExistingUserSignUp({ user })` — it fires
   on the duplicate path only, server-side, without telling the requester anything.
2. **Confirm the unique index exists** (query above). Better-auth's `coreSchema` declares
   `email: { unique: true }` (`@better-auth/core/dist/db/get-tables.mjs:160`). A `lower(email)`
   unique index additionally collapses `Foo@x` / `foo@x` at the DB level, matching better-auth's
   lowercase normalization. Cheap defense in depth, not urgent given the observed behaviour.
   If a duplicate row ever *is* found: delete sessions → accounts → user for the extra rows,
   then create the index.
3. **Decide on verification.** If unverified accounts must not be usable:
   ```ts
   emailAndPassword: { requireEmailVerification: true },
   emailVerification: {
     sendVerificationEmail: async ({ user, url }) => { /* real mailer */ },
     sendOnSignUp: true,
   },
   ```
   `requireEmailVerification` only blocks sign-in when `sendVerificationEmail` is implemented
   (`sign-in.mjs:338-350`); without it, sign-in throws `EMAIL_NOT_VERIFIED` for everyone.
4. **Close registration** if only known people may have accounts (internal tool):
   ```ts
   emailAndPassword: { enabled: true, disableSignUp: true },
   ```
   Accounts are then created by an admin (admin plugin `createUser`) or a seed script. This
   returns `EMAIL_PASSWORD_SIGN_UP_DISABLED` and is authoritative regardless of the UI.
5. **Optional domain allowlist** in `databaseHooks.user.create.before`: reject addresses outside
   the company domain, and normalize `email` to lowercase there.

## Frontend consequences (this repo)

The UI is not the control — the service is. Two concrete consequences:

1. **Sign-up can return `200` without creating anything** (existing email → synthetic user). So
   the sign-up screen must not claim "account created, you can sign in now" in a way that
   distinguishes an existing address from a new one. Show the same neutral "check your email /
   sign in" message on both paths — that is the whole point of the generic response. Never add
   client-side "this email is taken" logic; it would rebuild the oracle the service removed.
2. **If registration is closed**, remove `signUp` from the allowlist in
   `app/auth/[path]/page.tsx` so `/auth/sign-up` 404s instead of rendering a form that always
   fails. Until then, keep the form: it is the only way to create the first account.

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
