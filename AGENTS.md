# AGENTS.md

Working agreement for AI agents and humans building this frontend. Read this before
touching code. If reality disagrees with this file, update this file first.

## 1. What this is

An internal tool's web frontend. It consumes two services that already exist and are
**not** part of this repository:

- **Auth service** — a `better-auth` server exposing `/api/auth/*` (jwt plugin enabled,
  JWKS at `/api/auth/jwks`).
- **API service** — plain REST, protected by `Authorization: Bearer <jwt>` validated
  against the auth service's JWKS. No OpenAPI schema.

This repo is UI + a thin backend-for-frontend (BFF). It never owns user records, never
talks to a database, and never runs better-auth's server.

## 2. Stack (pin at scaffold time)

| Concern | Choice |
| --- | --- |
| Framework | Next.js 16.x, App Router, React 19, TypeScript `strict`, Cache Components + Partial Prefetching (scaffold defaults) |
| Package manager / scripts | **Bun** (install, `bun run`, `bun test`). Next itself runs on Node. |
| Auth | `better-auth` **client only** (`better-auth/react`), against the auth service via same-origin proxy |
| Auth screens | `better-auth-ui` via shadcn registry (`@better-auth-ui/auth`) |
| Styling | Tailwind CSS v4 + shadcn/ui (Radix), dark mode **only** |
| Server state | TanStack Query v5 (client) + RSC fetches (page load) |
| Forms | react-hook-form + zod (v4) |
| Validation | zod at every trust boundary (env, request params, upstream responses) |
| Tests | Vitest for units; manual smoke checklist. No e2e suite in v1. |
| Deploy | Portable: `output: "standalone"`, Docker + Node runtime, env-driven. No Vercel-only APIs. |

## 3. Architecture

```
Browser
  │  same-origin only, no CORS, no tokens in JS
  ├── /api/auth/*      ──proxy──▶  Auth service  /api/auth/*
  │                                  (Set-Cookie passed through, first-party)
  └── /api/backend/*   ──BFF───▶  API service   (Bearer JWT minted server-side)

Server Components ──▶ lib/api/server.ts ──▶ API service (same token path, no HTTP hop through Next)
```

- The browser only ever talks to this app's origin. Cookies are first-party, so no
  `SameSite=None`, no CORS, no cross-site cookie partitioning problems.
- OAuth start (`/api/backend/connect/:provider`) is a BFF **redirect**, not a JSON call:
  the API's 3xx is fetched with `redirect: "manual"`, the `Location` host is checked against
  `lib/connections.ts`, and only then handed to the browser as a `303`. Never let the
  browser call the API service directly, and never follow the consent URL server-side.
- The JWT is minted **per request, server-side**: read the session cookie →
  `GET {AUTH_SERVICE_URL}/api/auth/token` → `{ token }` → attach as Bearer.
  (Verified: the endpoint is GET-only; a POST returns a bare 404.)
- No refresh tokens, no token storage, no client secret.

## 4. Repo layout

```
app/
  auth/[path]/             better-auth-ui screens (sign-in, sign-up, forgot/reset, verify)
  (app)/                   authenticated area: layout guard + shell
  api/auth/[...all]/       auth proxy route handler
  api/backend/[...path]/   BFF proxy, allowlist-only
proxy.ts                   Next 16's renamed middleware: optimistic cookie check only
components/
  ui/                      shadcn primitives (generated, don't hand-edit upstream files)
  app/                     shell, nav, page-header, empty/error states
  auth/                    better-auth-ui components (generated)
  providers.tsx            QueryClient + AuthProvider (client boundary)
lib/
  auth/client.ts           createAuthClient() — same-origin, default basePath /api/auth
  auth/server.ts           getSession(), requireSession(), getAccessToken()
  api/server.ts            apiFetch(), parse with zod, error normalisation
  api/endpoints.ts         typed endpoint registry (the BFF allowlist)
  api/redirect.ts          host allowlist for upstream 3xx (OAuth start)
  connections.ts           connection providers + consent hosts
  api/schemas/             zod schemas for upstream payloads
  env.ts                   zod-validated env, server/public split
  errors.ts                ApiError, error mapping, safe messages
  redirect.ts              safeRedirect() — same-origin relative paths only
  csp.ts                   nonce-based Content-Security-Policy (pure, unit-tested)
  nav.ts                   nav registry (Home, Connections)
  ui-prefs.ts              cookie-backed UI preferences (sidebar rail)
  query-client.ts          one QueryClient per request / browser singleton
docs/
  auth-contract.md         verified auth service facts (Task T0.1)
  api-inventory.md         verified endpoints/payloads (Task T0.2)
```

## 5. Security invariants (non-negotiable)

1. **One credential in the browser:** the session cookie. `HttpOnly`, `Secure` in prod,
   `SameSite=Lax`, host-only. Never store tokens in `localStorage`/`sessionStorage` or
   readable cookies. Never ship a refresh token.
2. **The JWT never leaves the server.** Not in props, RSC payloads, JSON responses,
   logs, or error messages. Mint it, use it, drop it.
3. `API_URL` and `AUTH_SERVICE_URL` are server-only. No secret in `NEXT_PUBLIC_*`.
   Server modules import `server-only`.
4. **The BFF is deny-by-default.** A request is forwarded only if `method + path` matches
   a registered entry in `lib/api/endpoints.ts`. No blind catch-all passthrough — that is
   an open proxy / SSRF with the user's token attached.
5. **Never forward client-supplied `Authorization`.** Outbound auth headers are built by
   us, from our minted token. Strip `Host`, `Cookie`, `Content-Length`, `Connection`,
   `Transfer-Encoding` on ingress and reconstruct.
6. **Do not weaken better-auth's CSRF/origin checks.** Forward the browser's `Origin`
   and `X-Forwarded-*` intact so `trustedOrigins` matching works. Never disable
   `trustedOrigins`, never add `*`.
7. **Cookie passthrough is narrowing only.** Strip `Domain`, force `Path=/`, preserve
   `HttpOnly`/`Secure`/`SameSite`. Never widen cookie scope.
8. **Authorize on the server, every time.** Every protected layout and every BFF handler
   calls `requireSession()`. Hiding UI is not authorization.
9. **Open redirects are bugs.** Post-login `next`/`redirectTo` values must pass
   `safeRedirect()`: relative path, single leading `/`, no `//`, no scheme, no `\`.
10. **Validate upstream responses** with zod before rendering. Fail closed with a generic
    message + request id; never surface raw upstream bodies or stack traces.
11. **Time-box outbound calls** (`AbortSignal.timeout(10_000)`) and cap request bodies.
    Only `GET/POST/PUT/PATCH/DELETE` are proxied; `TRACE`/`CONNECT` rejected.
12. **Security headers** on every response: HSTS, `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`,
    minimal `Permissions-Policy`, and a nonce-based CSP (Task T5.1).
13. **Logging is redacted by default:** no cookies, no `Authorization`, no email bodies.
    Log request id + status + duration + route id.
14. **Dependencies:** lockfile committed, pinned versions, `bun audit` in CI, no
    unreviewed `postinstall` scripts.
15. HTTPS-only in production. No mixed content. Cookies `Secure`.
16. **`proxy.ts` is not authorization.** Cheap optimistic checks only (cookie presence)
    to avoid rendering the shell. Every protected server route still calls
    `requireSession()`. Never put network calls or session validation in `proxy.ts`.
17. **Next 16 specifics.** Read `node_modules/next/dist/docs/` before changing routing:
    middleware is `proxy.ts`; with `cacheComponents` an uncached read outside
    `<Suspense>` is a build error, so auth-reading routes set `export const instant = false`
    and block on the server; there is no `runtime` segment export.
18. **CSP nonces force a request-time render.** The nonce is minted in `proxy.ts` and applied
    during SSR, so a prerendered shell cannot carry one. The root layout therefore calls
    `connection()` and sets `instant = false`. Do not remove either without replacing the
    nonce policy: a static page under `script-src 'nonce-…'` would ship scripts that the
    browser refuses to run. `style-src` keeps `'unsafe-inline'` because nonces do not cover
    Radix `style` attributes — never add `'unsafe-inline'` to `script-src` instead.

## 6. Conventions

- **Server-first.** Default to Server Components; add `"use client"` only for state,
  effects, or browser APIs. Keep client bundles free of server modules.
- **Data:** RSC fetch for first paint (`lib/api/server.ts`); TanStack Query for
  interactive lists, filters, and mutations via `/api/backend/*`. Seed `initialData` from
  RSC rather than refetching on mount.
- **Mutations:** BFF route handler + `useMutation` + `queryClient.invalidateQueries`.
  Server Actions are acceptable for pure-UI-local actions only.
- **Errors:** throw `ApiError` with `status`, `code`, `requestId`; map to friendly copy in
  one place. `401` → sign-in redirect (preserve path). `403` → `/forbidden`. `5xx` →
  inline error state with retry.
- **Styling:** Tailwind utilities + shadcn tokens only. No hard-coded hex. Dark palette
  defined once in `globals.css` (`:root`/`.dark`). `class="dark"` on `<html>`; no theme
  toggle in v1.
- **A11y:** labelled inputs, visible focus rings, keyboard-reachable dialogs (Radix
  handles it), skip link, no color-only state. Target WCAG 2.1 AA.
- **Copy:** English, sentence case, no exclamation marks. No i18n scaffold in v1.
- **Naming:** `kebab-case` files, `PascalCase` components, `camelCase` functions,
  `SCREAMING_SNAKE` env keys.

## 7. Env contract

```dotenv
# server-only
AUTH_SERVICE_URL=https://auth.example.com   # no trailing slash
API_URL=https://api.example.com             # no trailing slash
# public
NEXT_PUBLIC_APP_NAME=Ryld
```

`lib/env.ts` validates lazily on first use (so `next build` doesn't need runtime config)
and throws on missing/malformed values. Local dev points at `http://localhost:8080` for
auth (verified reachable, `basePath=/api/auth`) and `http://localhost:8000` for the API
(verified 2026-11-14: FastAPI/uvicorn, `/openapi.json` disabled). `.env.example` is
committed; `.env*` is not.

**Dev gotcha to verify (T0.1):** if the auth service sets `__Secure-`-prefixed cookies
because it believes it is on HTTPS, those cookies are dropped by an `http://localhost`
browser. Dev must run the auth service without secure cookies, or the proxy must be
fronted by TLS.

## 8. Commands

```bash
bun install
bun run dev          # next dev (Turbopack)
bun run build        # next build → .next/standalone
bun run start        # next start locally; Docker uses node .next/standalone/server.js
bun run typecheck    # tsc --noEmit
bun run lint         # eslint .
bun run test         # vitest run
bun run check        # typecheck + lint + test   ← run before every handoff
```

`components/ui/**` and `components/auth/**` are registry-generated (shadcn CLI), so three
React Compiler lint rules are disabled there in `eslint.config.mjs`. Do not hand-edit
those files; re-run the CLI instead.

## 9. Definition of done (per task)

- `bun run check` passes.
- No new secret, token, or upstream URL reaches the client bundle (spot-check the build
  output for `API_URL` values).
- Happy path + one failure path exercised manually.
- Security invariants in §5 still hold; if a task touches auth or the BFF, say so in the
  summary and list what you verified.
- `docs/` updated when a service contract is learned.

## 10. Decision log

- **2026-11-13** — No better-auth server in this app; `better-auth` is installed for its
  React client only. Auth service remains the single source of truth.
- **2026-11-13** — Same-origin proxy instead of CORS/`SameSite=None` (different domains).
- **2026-11-13** — BFF-only tokens: server mints via jwt plugin `GET /api/auth/token`
  from the session cookie. Browser never sees a JWT. (Verified: GET returns 401 without a
  session; POST is not routed — a bare 404.)
- **2026-11-13** — Cache Components stays enabled (scaffold default). Auth-reading routes
  set `export const instant = false` and block on the server instead of streaming a shell
  that anonymous users should not see.
- **2026-11-13** — shadcn base `radix`, preset `nova`. Generated components are vendored
  and lint-exempted for React Compiler rules rather than forked.
- **2026-11-13** — `proxy.ts` holds only a cookie-presence check; it is a UX optimisation,
  never the authorization boundary.
- **2026-11-13** — Note for future agents: `create-next-app` generated an `AGENTS.md`
  containing only Next's managed block; this file must keep our content and the managed
  block (which `next dev` upserts in place).
- **2026-11-13** — `better-auth-ui` for auth screens; hand-rolled only if a screen is
  missing.
- **2026-11-13** — Dark mode only, responsive mobile + desktop, English only.
- **2026-11-13** — Internal tool: no SEO/marketing surface.
- **2026-11-13** — Single Next app, minimal tests (Vitest units + smoke checklist).
- **2026-11-13** — RBAC and Cloudflare Turnstile explicitly deferred, structured for now
  (T5.3, T5.4).
- **2026-11-13** — Upstream finding: the auth service **rejects** duplicate emails, but returns
  `200` with a fabricated user on the duplicate path (better-auth's generic duplicate response,
  active because `autoSignIn: false`). A `200` from sign-up therefore does not mean an account
  exists. This repo must never treat that response as proof of creation, and must never add
  email-existence checks in the UI. See `docs/auth-contract.md`.
- **2026-11-13** — `email` is display-only in this repo; `user.id` is the identity key. Do not add
  email-keyed caches or lookups.
- **2026-11-13** — CSP is enforced, not report-only, and `style-src` keeps `'unsafe-inline'`
  because CSP nonces do not cover `style` attributes (Radix positioning breaks without it).
  Script injection stays nonce-locked. Accepted cost: the root layout must render per request,
  so `/` and `/_not-found` are dynamic. Verified: 16/16 rendered script tags carry the nonce.
- **2026-11-13** — Deployment (Phase 6) deferred by the owner; Docker/standalone smoke is not
  part of the current scope.
- **2026-11-14** — App shell follows the Cloudflare dashboard reference: near-black canvas,
  a darker sidebar, hairline borders, and a raised pill for the active row. Two destinations
  only — Home and Connections. `/dashboard` is kept as a redirect to `/home`.
- **2026-11-14** — The sidebar rail preference is a cookie (`ryld_sidebar`), not
  localStorage, so `app/(app)/layout.tsx` can render the first paint at the right width. The
  shell is a client component only where it needs state (collapse, search, drawer); page
  content stays server-rendered.
- **2026-11-14** — Connection OAuth starts through the BFF (`/api/backend/connect/:provider`)
  with `redirect: "manual"` and an exact host allowlist; the browser receives a `303`.
  Providers are declared in `lib/connections.ts` and generated into the BFF allowlist, so a
  provider cannot exist in the UI without an explicit endpoint and consent host.
- **2026-11-14** — API service dev URL is `http://localhost:8000`. `GET /connect/youtube`
  now redirects to Google's sign-in/consent screen (verified 2026-11-14; the earlier
  `redirect_uri_mismatch` is resolved). The BFF path is verified end to end:
  authenticated → `303` + `Location: https://accounts.google.com/...`, anonymous → `307` to
  sign-in, unknown provider or traversal → `404`. Google's client display name is still
  "rayload", and the upstream `state` is the user id rather than a random nonce — both are
  API-service concerns, recorded in `docs/api-inventory.md`.
- **2026-11-14** — `app/(app)/layout.tsx` awaits `connection()` before rendering the shell.
  The shell imports better-auth's client, whose store reads `Date.now()`; under
  cacheComponents that is an unstable value if the subtree is ever prerendered, and dev
  reports it as a blocking-prerender error. The area is session-gated, so request-time
  rendering is correct rather than a workaround.

## 11. Deferred / follow-ups

- Cloudflare Turnstile on sign-up/sign-in (auth service plugin + widget) — **needed, not v1**.
- Role/permission-aware UI and admin routes.
- Rate limiting for BFF routes (edge/nginx first, app-level later).
- Session/token caching across requests (only if latency demands it).
- Seed the TanStack cache with the server session (`authQueryKeys.session`) so auth UI
  skips its first client fetch.
- Enable `typedRoutes` once the generated auth components are confirmed compatible.
- Realtime (SSE/WS) and file uploads — out of scope for v1.
- i18n scaffold — out of scope for v1.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
