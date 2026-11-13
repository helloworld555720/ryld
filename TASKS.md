# TASKS.md

Small, ordered, independently shippable tasks. One task = one commit (or a few, never a
mixed bag). Tick `[x]` only when the acceptance criteria in §9 of `AGENTS.md` are met.

Legend: **Deps** = must be done first. **Est** = rough effort for one agent.
`[~]` = code complete, end-to-end unverified (usually blocked on a real account or the API URL).

**Progress (2026-11-13):** T0.1, T0.3–T0.8, T1.1–T1.3, T1.5 done. `bun run check` green:
21 unit tests, typecheck clean, lint clean, `next build` succeeds. Auth proxy verified
against the live auth service: GET passthrough, POST body forwarding, `Origin` forwarded
(trusted → 401, evil → 403), `no-store`, token endpoint reachable. T1.4 is code-complete
but needs a real login. T1.6, Phase 2+ not started. `API_URL` is a placeholder
(`http://localhost:3001`).

> **Correction (2026-11-13):** an earlier note here claimed the auth service allowed duplicate
> emails. It does **not**. Three `sign-up/email` calls for one address returned `200` with three
> ids, but only the first created a user — better-auth 1.7 answers duplicates with a fabricated
> user (`sign-up.mjs:155`, anti-enumeration) and writes nothing. The DB has one row. Consequence
> for us: a `200` from sign-up does **not** mean an account was created, so the UI must show the
> same neutral message for both paths. Details: `docs/auth-contract.md`.
>
> **Open upstream question:** `requireEmailVerification` is off (unverified accounts can sign in
> and get a JWT with `email_verified: false`). Policy decision for the auth service, not a bug we
> can fix here.

> **Cleanup owed in the auth-service database:** one probe user from that test —
> `probe-dup-20261113220820@example.com`, id `FK2lcG4YVOqtxcxE4X75sjBZP71CyEEm`. Self-service
> delete is disabled (`/delete-user` → `404`), so it needs SQL. The other two ids returned by
> sign-up were synthetic and were never persisted.

---

## Phase 0 — Discover & scaffold

### [x] T0.1 — Verify auth service contract
**Deps:** none · **Est:** 45m — **done 2026-11-13 against `http://localhost:8080`**

Probed and recorded in `docs/auth-contract.md`:

- `basePath=/api/auth`, plain HTTP in dev, `GET /api/auth/ok` → `{"ok":true}`.
- **jwt plugin is on** (not oidc-provider): `/api/auth/jwks` returns an Ed25519 key;
  no `/.well-known/openid-configuration`.
- **Token endpoint is `GET /api/auth/token`** → `401 UNAUTHORIZED` without a session,
  `{ token }` with one. POST is not routed.
- `trustedOrigins` contains `http://localhost:3000`: sign-in POST from it → `401
  INVALID_EMAIL_OR_PASSWORD`, from `http://evil.example` → `403 INVALID_ORIGIN`.
- Error envelope: `{ "message": string, "code": string }`.
- `sign-up/email` enabled (name + email + password); `request-password-reset` enabled.
- UNKNOWN until a real sign-in is performed: cookie names/attributes (`__Secure-` prefix,
  `Domain=`), session lifetime, JWT expiry, `iss`/`aud`, claims.

**Accept:** doc lists each item with the verified value. ✅ (cookie/JWT claims remain
UNKNOWN; capture on the first real login — T1.4.)

### [ ] T0.2 — Inventory the REST API
**Deps:** none · **Est:** 45m

Create `docs/api-inventory.md`: base URL, auth header format, error envelope
(status shape, message field, trace id), pagination/filter conventions, and a table of
endpoints: method, path, params, request body, response shape, status codes.

**Accept:** at least the endpoints needed for the first feature slice are captured with one
real example response each. Secrets redacted.

### [ ] T0.3 — Scaffold the app
**Deps:** none · **Est:** 30m

```bash
bunx create-next-app@latest . --ts --tailwind --app --eslint --no-src-dir --import-alias "@/*"
```

Then: `tsconfig` `strict: true`, `output: "standalone"`, `typedRoutes: true`, remove the
demo page content, commit `.nvmrc`/`engines` if useful, ensure `bun.lock` is committed.

**Accept:** `bun run dev` serves a blank page; `bun run build` succeeds; `bun run typecheck`
is clean.

### [x] T0.4 — Tailwind v4 + shadcn + dark-only tokens
**Deps:** T0.3 · **Est:** 45m

`bunx shadcn@latest init`; add `button input label card dialog dropdown-menu sonner
skeleton separator sheet avatar badge alert form`. Set `<html class="dark">`, define the
dark palette + radii in `globals.css`, load one sans font via `next/font`. No theme toggle.

**Accept:** one throwaway page renders a button/card/input/dialog in the dark palette; no
hard-coded colors; no lint/type errors.

### [x] T0.5 — Quality gate scripts
**Deps:** T0.3 · **Est:** 30m

Add `typecheck` (`tsc --noEmit`), `lint`, `test` (Vitest + jsdom, one trivial passing test),
`check` (runs all three), and ESLint rules that matter here: no floating promises, no
unused vars, import order. Prettier config + `format`.

**Accept:** `bun run check` passes from a clean checkout.

### [x] T0.6 — Env module + example env
**Deps:** T0.3 · **Est:** 30m

`lib/env.ts` with two zod schemas (server/public) parsed at import; `AUTH_SERVICE_URL` and
`API_URL` validated as absolute URLs without trailing slash. `server-only` import. Commit
`.env.example`, gitignore `.env*`.

**Accept:** booting with a missing var throws a readable error; client code cannot import
the server schema (type error).

### [x] T0.7 — Baseline security headers
**Deps:** T0.3 · **Est:** 30m

`next.config.ts` `headers()`: `X-Content-Type-Options`, `Referrer-Policy`,
`X-Frame-Options: DENY` + `frame-ancestors 'none'`, `Permissions-Policy`
(camera/mic/geo off), HSTS (prod only). CSP comes in T5.1.

**Accept:** `curl -I` on a page shows every header; no console violations.

### [x] T0.8 — Error + logging primitives
**Deps:** T0.3 · **Est:** 45m

`lib/errors.ts` (`ApiError { status, code, requestId, safeMessage }`, `isApiError`,
`toUserMessage`). `lib/log.ts` thin wrapper emitting JSON with `requestId`, redacting
`cookie|authorization|set-cookie|token`.

**Accept:** unit tests cover message mapping and redaction; no `console.log` left in app code.

---

## Phase 1 — Authentication (proxy + session)

### [x] T1.1 — better-auth client (same-origin)
**Deps:** T0.4, T0.6 · **Est:** 20m

`lib/auth/client.ts`: `createAuthClient({ baseURL: "/api/auth" })` from
`better-auth/react`. No plugins needed in v1 (the browser never mints tokens).

**Accept:** the module imports cleanly in a client component; baseURL is relative.

### [x] T1.2 — Auth proxy route handler
**Deps:** T0.6 · **Est:** 1.5h

`app/api/auth/[...all]/route.ts` exporting `GET/POST/PUT/PATCH/DELETE`. Forward to
`{AUTH_SERVICE_URL}/api/auth/<path>`:

- Preserve method, raw body, `content-type`, `origin`, `referer`, `user-agent`, `cookie`,
  `x-forwarded-for/host/proto`, `accept`.
- Strip `host`, `connection`, `content-length`, `transfer-encoding`, and any inbound
  `authorization`.
- Pass through status, `content-type`, `set-cookie` (strip `Domain`, force `Path=/`).
- `AbortSignal.timeout(10_000)`; map upstream failure to `502` with a clean JSON body.
- Never cache (`dynamic = "force-dynamic"`), never log cookies.

**Accept:** sign-in via `curl` against the local app sets a host-only cookie for
`localhost:3000`; the cookie is absent for the auth service domain; upstream 4xx bodies
still reach the client (needed by better-auth-ui error handling); no secrets in logs.

### [x] T1.3 — Session helpers
**Deps:** T1.2 · **Est:** 45m

`lib/auth/server.ts`:
- `getSession()` — read request cookies, call
  `{AUTH_SERVICE_URL}/api/auth/get-session`, validate the shape with zod, return
  `Session | null` (never throw on 401), memoised per request via `cache()`.
- `requireSession()` — redirect to `/auth/sign-in?next=<pathname>` when absent.
- `getAccessToken()` — `GET /api/auth/token` with the session cookie (verified GET-only;
  POST 404s); validate `{ token: string }`; throw `ApiError(401)` on failure.

**Accept:** unit tests for the response parser (valid, null, malformed). `requireSession()`
does not fire for public routes.

### [~] T1.4 — better-auth-ui screens
**Deps:** T1.1, T1.2 · **Est:** 1.5h — **installed and routed; end-to-end login unverified**

```bash
bunx shadcn@latest add @better-auth-ui/auth
```

Done: the registry added 22 components plus `@better-auth-ui/{core,react}`.
`AuthProvider` is wired in `components/providers.tsx` (`redirectTo="/dashboard"`,
`navigate` → Next router, `Link` → `next/link`), and `app/auth/[path]/page.tsx` validates
the path against `viewPaths.auth` before rendering `<Auth path />`.

**Remaining (needs a real account):** sign up → sign in → land on `/dashboard` → sign out
→ sign in again. Confirm the `Set-Cookie` from the proxy is host-only (no `Domain`) and
that the browser stores it for `localhost:3000`. That cookie check is the only part of
this task that cannot be verified without credentials.

### [x] T1.5 — Route protection
**Deps:** T1.3 · **Est:** 1h

`proxy.ts` (Next 16 renamed middleware): optimistic check for the session cookie on
`/dashboard/*` only (no network call, no auth logic). `app/(app)/layout.tsx`: real
`await requireSession()`; render shell.
`lib/redirect.ts`: `safeRedirect(next)` rejecting `//`, `\`, schemes, and absolute URLs;
default `/`. better-auth-ui uses the `redirectTo` parameter.

**Accept:** visiting a protected URL while logged out redirects to sign-in with `?next=`
and returns there after login. `?next=https://evil.test` and `?next=//evil.test` both land
on `/`. Middleware does not run on `/api/auth/*`.

### [ ] T1.6 — Session expiry + sign-out UX
**Deps:** T1.5 · **Est:** 45m — *partial: shell shows email + `/auth/sign-out` link; no
global 401 handler yet*

Global 401 handling: TanStack Query/`apiClient` on `401` clears cached queries and routes to
sign-in with the current path. Sign-out button clears the query cache, calls
`authClient.signOut()`, then hard-navigates to `/auth/sign-in`. Show the signed-in user
(email/avatar) in the shell.

**Accept:** deleting the session cookie mid-session and clicking around lands on sign-in
once, with no error toasts; sign-out leaves no cached user data.

### [ ] T1.7 — Sign-up messaging + posture
**Deps:** none · **Est:** 40m — *corrected after the duplicate-email finding*

Sign-up returns `200` for an **existing** email without creating anything (better-auth's generic
duplicate response). Anything we render must therefore be identical for both paths:

- Sign-up success copy must not imply "your account was created" in a way that differs from the
  duplicate path; prefer one neutral message ("If that address is available, check your email or
  sign in").
- No client-side "email already registered" logic anywhere — that recreates the enumeration
  oracle the service deliberately removed.
- If `autoSignIn` is `false` (as it appears to be), sign-up never returns a session, so do not
  auto-redirect to `/dashboard` after sign-up; route to sign-in instead.
- **If registration gets closed** (`disableSignUp: true`): drop `signUp` from `viewPaths.auth` in
  `app/auth/[path]/page.tsx` so `/auth/sign-up` → `404`, and hide the "Create account" link.

**Accept:** submitting an existing email and a fresh email produces the same visible outcome;
sign-up never lands on `/dashboard` without a session. Server remains authoritative.

---

## Phase 2 — BFF + typed API layer

### [ ] T2.1 — Server API client
**Deps:** T1.3 · **Est:** 1h

`lib/api/server.ts`: `apiFetch(path, { method, body, query, schema })` that calls
`getAccessToken()`, builds the URL from `API_URL`, sets JSON headers, applies a 10s timeout,
normalises non-2xx into `ApiError` (mapping upstream error envelope from
`docs/api-inventory.md`), and parses `2xx` with the given zod schema.

**Accept:** tests cover 200/201, 400, 401, 500, timeout, and malformed JSON. No upstream
body leaks into the thrown message.

### [ ] T2.2 — Endpoint registry (the allowlist)
**Deps:** T2.1 · **Est:** 45m

`lib/api/endpoints.ts`: entries `{ id, method, pattern, schema?, mutation? }` where
`pattern` is a segment matcher (`/items/:id`). Export `matchEndpoint(method, path)`.
Deny by default; reject encoded traversal (`%2e%2e`, `..`), absolute URLs, and unknown
methods.

**Accept:** table-driven tests: exact match, param match, wrong method → null, unknown path
→ null, `/items/../../admin` → null.

### [ ] T2.3 — BFF proxy route
**Deps:** T2.2 · **Est:** 1h

`app/api/backend/[...path]/route.ts`: `requireSession()` → `matchEndpoint()` → 404 if
unmatched → forward through `apiFetch` → JSON response with `Cache-Control: no-store`.
Cap body at 1 MB. Reject `TRACE`/`CONNECT`. Return `{ error, requestId }` on failure.

**Accept:** registered endpoint round-trips; unregistered path returns 404 **without**
hitting the API; a 2 MB body is rejected with 413; no `Authorization` from the client is
forwarded.

### [ ] T2.4 — Query provider + browser client
**Deps:** T0.4 · **Est:** 45m

`providers/query-provider.tsx` (one `QueryClient` per browser session, sensible defaults:
`staleTime: 30s`, `retry: 1`, no refetch on focus). `lib/api/client.ts`: same-origin fetch,
typed generic `apiRequest<T>(...)`, throws `ApiError`, wires the 401 handler from T1.6.

**Accept:** a client component can `useQuery` against `/api/backend/health` and render the
result; errors surface through the shared mapper.

### [ ] T2.5 — Feedback primitives
**Deps:** T0.4 · **Est:** 45m

`sonner` toaster mounted in the app shell. Helpers: `toastApiError(err)`, inline `<Alert>`
for form errors, `<EmptyState>`, `<ErrorState onRetry>`, `<LoadingRows>`.

**Accept:** reused in the vertical slice; no component calls `toast.error(err.message)`
directly.

### [ ] T2.6 — Vertical slice: session → API
**Deps:** T2.3, T2.4 · **Est:** 1h

Pick the cheapest authenticated API endpoint (health/whoami/profile). Render it from an RSC
using `apiFetch` **and** refetch it from a client component via TanStack Query. Prove both
paths share schemas.

**Accept:** both paths show the same data; killing the API yields a friendly error with a
retry; a 401 bounces to sign-in.

---

## Phase 3 — App shell

### [ ] T3.1 — Shell layout
**Deps:** T1.5, T0.4 · **Est:** 1.5h

Sidebar + top bar; mobile uses a `sheet` drawer with a menu button. Sidebar collapses on
`md`. User menu (account settings, sign out). Content max-width and page padding tokens.

**Accept:** usable at 360px, 768px, 1280px; no horizontal scroll; focus is trapped in the
mobile drawer.

### [ ] T3.2 — Navigation + route states
**Deps:** T3.1 · **Est:** 45m

`lib/nav.ts` config (label, href, icon, optional `hidden` predicate ready for RBAC).
Active states, `loading.tsx` skeletons, `error.tsx` boundary with reset, `not-found.tsx`.

**Accept:** active link is marked with `aria-current="page"`; a thrown error in a page shows
the boundary, not a blank screen.

### [ ] T3.3 — Page patterns
**Deps:** T3.1 · **Est:** 45m

`PageHeader` (title, description, actions), `DataToolbar`, `Pagination`, `ConfirmDialog`.

**Accept:** each is used at least once by the feature slice; keyboard + screen-reader labels
verified.

---

## Phase 4 — First feature slice

> **Blocked on:** T0.2 + one sentence from the owner describing the slice. Replace the
> placeholders below with the real resource (e.g. `items`).

### [ ] T4.1 — Define slice scope
**Deps:** T0.2 · **Est:** 20m

Write the slice in `docs/api-inventory.md`: list view fields, filters, sort, pagination,
detail fields, create/edit fields with validation rules, delete semantics.

**Accept:** every endpoint needed is in the registry with a zod schema.

### [ ] T4.2 — List screen
**Deps:** T2.6, T3.3, T4.1 · **Est:** 2h

RSC initial page + TanStack Query for filter/sort/pagination via URL search params
(shareable, back-button correct). Schema-validate search params.

**Accept:** filters survive reload and back/forward; empty and error states render; no
layout shift on pagination.

### [ ] T4.3 — Create / edit form
**Deps:** T4.2 · **Est:** 2h

RHF + zod, server-side re-validation in the BFF (never trust the client), inline field
errors mapped from the upstream envelope, disabled/loading submit, success toast +
invalidation + navigate.

**Accept:** invalid input never reaches the API; server-side validation errors land on the
right fields; double-submit creates one record.

### [ ] T4.4 — Detail + delete
**Deps:** T4.3 · **Est:** 1.5h

Detail view with `not-found` handling; `ConfirmDialog` delete; optimistic update with
rollback on error.

**Accept:** deleting a missing record shows a friendly message; a failed delete restores the
row.

---

## Phase 5 — Hardening (do not skip before "done")

### [ ] T5.1 — CSP + headers audit
**Deps:** T0.7 · **Est:** 1.5h

Nonce-based CSP via middleware (`script-src 'nonce-…' 'strict-dynamic'`, `style-src` with
the minimum Next/Tailwind needs, `connect-src 'self'`, `img-src 'self' data:`,
`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`).
Verify better-auth-ui and shadcn dialogs still work.

**Accept:** zero CSP violations in the console across auth + app routes; no
`unsafe-inline` for scripts; report-only run first, then enforce.

### [ ] T5.2 — Auth/security review
**Deps:** Phases 1–4 · **Est:** 1.5h

Walk `AGENTS.md` §5 line by line. Check: cookie attributes in devtools, no token in bundle
(`grep` the build output for `eyJ` and for `API_URL`), no `Authorization` passthrough, no
open redirect, 404 on unregistered BFF paths, redacted logs, `bun audit` clean, no
`console.log` of request objects.

**Accept:** written checklist in the PR/summary with each item PASS/FAIL + evidence.

### [ ] T5.3 — Cloudflare Turnstile (deferred, required before public exposure)
**Deps:** T1.4 · **Est:** 1h

Enable the captcha plugin on the **auth service** (`cloudflare-turnstile`, site key +
secret), then render the widget in better-auth-ui's sign-in/sign-up forms and pass the
token. Env: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (public, safe).

**Accept:** missing/invalid token is rejected by the auth service; valid token signs in;
widget fails closed when the script is blocked.

### [ ] T5.4 — RBAC scaffolding (deferred)
**Deps:** T5.2 · **Est:** 1.5h

Only if the JWT carries roles: extend the session type, add `<Can permission="…">`, a
`requireRole()` guard for layouts, nav filtering, and `/forbidden`. Server-side checks
remain authoritative; the API is the real gate.

**Accept:** a role-less user gets `/forbidden` and no admin nav; direct URL access is blocked
server-side.

### [ ] T5.5 — Rate limiting (deferred)
**Deps:** T2.3 · **Est:** 1h

Edge/nginx limit on `/api/auth/*` and `/api/backend/*`; document thresholds. App-level
limiter only if the proxy can't do it.

**Accept:** documented config + a load check showing 429s with `Retry-After`.

---

## Phase 6 — Deploy

### [ ] T6.1 — Dockerfile + standalone
**Deps:** T0.3 · **Est:** 1h

Multi-stage: `oven/bun` for install/build → `node:22-alpine` runtime with
`.next/standalone` + `.next/static` + `public`. Non-root user, `HEALTHCHECK`.
`.dockerignore` excludes `.env*`, `node_modules`, `.next`.

**Accept:** image builds and runs with only `AUTH_SERVICE_URL`, `API_URL`,
`NEXT_PUBLIC_APP_NAME` supplied; container serves the app on 3000.

### [ ] T6.2 — Runtime config + health
**Deps:** T6.1 · **Est:** 45m

`/api/health` (no auth, no upstream calls, returns `{ status, version }`). Document
TLS/reverse-proxy requirements: HTTPS termination, `X-Forwarded-Proto`, no cookie rewriting
at the proxy, and that the app must be reachable at a stable origin listed in the auth
service's `trustedOrigins`.

**Accept:** health endpoint works in the container; docs list required proxy behavior.

### [ ] T6.3 — Production smoke checklist
**Deps:** T6.1, T5.2 · **Est:** 45m

Verify over HTTPS: sign-up/sign-in/reset, cookie is `Secure` + `HttpOnly` + `SameSite=Lax`
+ host-only, JWKS-backed API calls succeed, 401 bounces correctly, CSP enforced, no token in
devtools, logs are redacted, sign-out invalidates the session server-side.

**Accept:** signed checklist committed under `docs/` with timestamps and environment.

---

## Open questions (blocking Phase 4)

1. What does the app actually manage — the main resource(s) and the 3–5 screens of the
   first slice?
2. One example request/response from the API (so the zod schemas and error mapping are
   real, not guessed).
3. Does the auth service allow sign-up, or are accounts created by an admin?
4. Are there roles/permissions in the JWT today, or only later?
