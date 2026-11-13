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

## Duplicate accounts: **allowed** (verified 2026-11-13)

Direct against the auth service, three sequential `POST /api/auth/sign-up/email` calls with the
**same** email (one of them uppercase, normalized to lowercase in storage) all returned `200`
and created three distinct users:

| Attempt | Stored email | User id |
| --- | --- | --- |
| 1 (lowercase) | `probe-dup-20261113220820@example.com` | `FK2lcG4YVOqtxcxE4X75sjBZP71CyEEm` |
| 2 (identical body, ~1.3 s later) | same | `2KfCOFG83d8DXLDmG9NlsMaSEBWQhJE4` |
| 3 (uppercase body) | same (lowercased) | `uvXU21uEXcRrySz6CZbV840fhfROywBi` |

Two separate defects, one fix each:

1. **No unique constraint on `user.email` in the database.** This is proven, not inferred: three
   inserts of the identical value committed. better-auth's own `coreSchema` declares
   `email: { unique: true }` (`@better-auth/core/dist/db/get-tables.mjs`), so the table was
   created without the constraint (hand-written SQL, a schema push that dropped it, or a
   non-better-auth migration).
2. **The application-level duplicate check did not fire.** Stock better-auth calls
   `internalAdapter.findUserByEmail(normalizedEmail)` and throws
   `422 USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL` (`better-auth/dist/api/routes/sign-up.mjs`).
   Attempt 2 posted a byte-identical body and still created a new user, so either the service
   exposes a custom sign-up handler that skips the check, or the lookup path cannot see the
   row written ~1 s earlier (read replica / negative cache). Find out which from the service's
   code — but the unique index is what makes it impossible either way.

**Also observed:** `emailVerified: false` accounts can sign in and receive a session. The JWT
then carries `email_verified: false`. So `requireEmailVerification` is effectively off.

**Impact:** the second and later accounts for an email shadow the first; whoever registers an
address first does not own it, and password reset would pick one of the duplicates
non-deterministically. Treat as a security bug in the auth service, not a UI issue.

## Remediation — auth service (owner: auth service, not this repo)

1. **Dedupe, then constrain** (mandatory; fixes the class of bug):
   ```sql
   -- find duplicates (case-insensitive, since emails are stored lowercased)
   SELECT lower(email) AS email, count(*)
   FROM "user" GROUP BY 1 HAVING count(*) > 1;

   -- keep one per email (e.g. the verified one, else the oldest), delete the rest
   -- for each duplicate: sessions -> accounts -> user, in that order
   DELETE FROM session WHERE "userId" IN (SELECT id FROM "user" WHERE id = $victim);
   DELETE FROM account WHERE "userId" IN (SELECT id FROM "user" WHERE id = $victim);
   DELETE FROM "user" WHERE id = $victim;

   CREATE UNIQUE INDEX "user_email_unique" ON "user" (lower(email));
   ```
   Re-running better-auth's own migrate/`generate` would also emit this index; the `lower(email)`
   form additionally makes `Foo@x` and `foo@x` collide at the DB level, which matches
   better-auth's lowercase normalization.
2. **Keep the app-level check and map the DB error.** Catch the unique violation on user create
   and return `USER_ALREADY_EXISTS` so concurrent sign-ups get a clean 422 instead of a 500.
3. **Turn email verification on for real**, if accounts should not be usable before verifying:
   ```ts
   emailAndPassword: { enabled: true, requireEmailVerification: true },
   emailVerification: {
     sendVerificationEmail: async ({ user, url }) => { /* wire a real mailer */ },
     sendOnSignUp: true,
   },
   ```
   `requireEmailVerification` only blocks sign-in when `sendVerificationEmail` is implemented.
4. **Close registration** if only known people may have accounts (internal tool):
   ```ts
   emailAndPassword: { enabled: true, disableSignUp: true },
   ```
   Accounts are then created by an admin (admin plugin `createUser`) or a seed script. This
   returns `EMAIL_PASSWORD_SIGN_UP_DISABLED` and is authoritative regardless of the UI.
5. **Defense in depth — domain allowlist** in `databaseHooks.user.create.before`: reject
   addresses outside the company domain, and normalize `email` to lowercase there.

## Frontend consequences (this repo)

The UI is not the control — the steps above are. But to avoid offering a dead-end form:
remove `signUp` from the allowlist in `app/auth/[path]/page.tsx` once the service closes
registration, so `/auth/sign-up` 404s instead of rendering a form that always fails.

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
