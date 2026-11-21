# AGENTS.md

Working agreement for AI agents and humans building this frontend. Read this before
touching code. If reality disagrees with this file, update this file first.

## 0. Scope — hard rule

Work only inside this repository: `C:\Users\SAHAN\Documents\projects\ryld`. Every read,
write, edit, delete and command must resolve inside this directory.

- Never inspect, modify or execute anything in a parent directory, a sibling project, the
  home directory, or system/global configuration.
- No `cd ..`, no absolute paths that escape the root, no editing `~/.config`, no global
  installs or edits to globally installed tooling.
- Harness-managed scratch space (screenshots, command output) is the only exception, and it
  is write-only scratch: never use it to change files outside this repository.
- If a task appears to require crossing this boundary, stop and ask instead of proceeding.

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
  │  same-origin only, no CORS
  ├── /api/auth/*      ──proxy──▶  Auth service  /api/auth/*
  │                                  (Set-Cookie passed through, first-party)
  ├── /api/backend/*   ──BFF───▶  API service   (Bearer JWT minted server-side)
  └── /api/token       ──mint──▶  Auth service  (POST-only; explicit user request)

Server Components ──▶ lib/api/server.ts ──▶ API service (same token path, no HTTP hop through Next)
```

- The browser only ever talks to this app's origin. Cookies are first-party, so no
  `SameSite=None`, no CORS, no cross-site cookie partitioning problems.
- The browser holds no token except in the memory of the `/api-token` page, and only
  after the signed-in user clicks Generate. Everything else goes through the BFF.
- OAuth is two BFF hops, both same-origin: the Connect anchor hits
  `GET /api/backend/connections/:provider/start`, which issues the upstream `POST`
  with our callback URL and hands the browser the consent `303` after checking the
  `Location` host against `lib/connections.ts`; the provider later redirects to
  `GET /api/backend/oauth/:provider/callback`, which mints the JWT again, exchanges the
  code upstream, and `303`s back to `/connections`. Never let the browser call the API
  service directly, and never follow the consent URL server-side.
- **Connect opens in a popup.** A plain left click sets a short-lived
  `ryld_oauth_popup` marker cookie and opens the start URL in a named window. The provider
  can only redirect to the one registered callback, so that marker is how the callback
  knows to answer `303 /connections/complete?...` instead of `/connections`: a bare page
  that posts a same-origin `ryld:oauth` message to its opener and closes. The opener maps
  the message through the provider registry, toasts, and calls `router.refresh()`.
  Modifier/middle clicks and a blocked popup keep the original full-page redirect.
- The JWT is minted **per request, server-side**: read the session cookie →
  `GET {AUTH_SERVICE_URL}/api/auth/token` → `{ token }` → attach as Bearer.
  (Verified: the endpoint is GET-only; a POST returns a bare 404.)
- **Projects** are created with `POST /api/backend/projects`. The body is parsed
  against the input/output registries (`lib/projects.ts`) and only the declared
  fields are forwarded to the API's `POST /jobs/`. The API calls the resource a *job*;
  this app never does — the browser path and every identifier here say project, and
  the rename lives in `lib/api/endpoints.ts`.
- **A project is saved as a draft or submitted.** `POST /jobs/` takes a top-level
  `submit` boolean (added upstream 2026-11-21): `true` queues it (`status: "pending"`),
  `false` or omitted leaves `status: "draft"`. The dialog therefore ends in two buttons,
  `Save as draft` (outline, first in the DOM) and `Submit`; they post the same validated
  payload and differ only in `submit`. Enter activates the first button, so implicit
  submission saves a draft. Submission is irreversible through the API — a pending project
  answers `409` to `DELETE` — which is why the reversible action is the default.
  `projectStatusLabel()` gives `pending` copy and the card shows the status the API returns.
- **A processed project reports its result in `source`.** `source` is `null` on creation; once
  a submitted project finishes, the API fills it with a discriminated object — `hls` so far,
  carrying `title`, `playlist`, `poster`, `thumbnails`, `captions` and `chapters`, all of which
  are storage keys relative to the output rather than URLs. `PROJECT_SOURCE_KINDS` in
  `lib/projects.ts` turns the kind into card rows (`summarizeProjectSource`), so a new result
  kind is one registry entry. Because the vocabulary is the API's, `projectSchema` validates
  only that `source` is `null` or an object with a non-empty `type`: an unknown kind renders no
  rows instead of failing the whole list. Failed projects keep `source: null`, and nothing but
  a `draft` can be deleted (`409` after submission).
- **The projects page lists them as cards.** `GET /jobs/` is read server-side
  (`lib/api/projects.ts`, no hop through our own BFF) and rendered by
  `components/app/project-card.tsx`. The card is registry-driven like the form: the title,
  icon and detail rows come from the `type` on each side (`summarizeProjectInput`), so a new
  source or destination appears without touching the card. A failed list renders "we
  couldn't load your projects", never the empty state — "no projects" would be a lie when we
  could not ask. Creating through the dialog calls `router.refresh()` so the new card shows
  without a reload.
- **A Google Drive source is a file you already own.** The registry declares a
  `connection-account` field (`conn_id`, defaulting to the first connected Drive account) and a
  `gdrive-file` field (`file_id`), so the payload is `{type, conn_id, file_id}`. The file is
  chosen with Google's Picker in the browser: `components/app/google-drive-file-picker.tsx`
  loads `https://apis.google.com/js/api.js` on demand (`gapi.load("picker")`), fetches
  `GET /api/backend/connections/gdrive/config` (API key + Cloud project number, sent as
  `appId`) and `POST /api/backend/connections/gdrive/access-token`, then opens
  `DocsView(ViewId.DOCS).setMode(LIST)`. Only the picked `{id, name}` reaches the form.
  Changing the account clears the file so a file id from another account can never be
  submitted. CSP keeps the Picker iframe working with one `frame-src` host and nothing else:
  the script is appended dynamically, so `strict-dynamic` trusts it and `script-src` gained
  no remote host.
- **A YouTube destination publishes to a connected channel.** The registry declares a
  `connection-account` field (`conn_id`, defaulting to the first connected YouTube account)
  plus the twelve upload options the API accepts and echoes back with defaults: `title`,
  `description`, `tags`, `category_id`, `default_language`, `privacy`, `publish_at`,
  `embeddable`, `public_stats_viewable`, `made_for_kids`, `contains_synthetic_media` and
  `thumbnail_url`. Each field carries its own `control` (`text`, `textarea`, `select`,
  `switch`, `datetime`) and its own zod schema, so the form renders it and both sides of the
  BFF validate it from the registry alone. A field schema accepts the form's value *and* the
  wire value and normalises to the wire one (blank text → `null`, `"a, b"` → `["a","b"]`,
  `"true"` → `true`, `datetime-local` → ISO instant, `"unset"` → `null`). The dialog groups
  the options under `Details`, `Playback` and `Audience` from each field's `group`, and lays
  them out in a two-column grid where `fieldLayout()` (or a field's `layout`) decides full or
  half width. S3 stays the default destination; YouTube is second.
- No refresh tokens, no token storage, no client secret.

## 4. Repo layout

```
app/
  auth/[path]/             better-auth-ui screens (sign-in, sign-up, forgot/reset, verify)
  (app)/                   authenticated area: layout guard + shell
    api-token/             developer token page (explicit JWT exception, see §5.2)
    projects/              project list (cards) + creation dialog
  connections/complete/    popup completion page: messages the opener, closes
  api/auth/[...all]/       auth proxy route handler
  api/backend/[...path]/   BFF proxy, allowlist-only
  api/token/               POST-only JWT mint for the token page
proxy.ts                   Next 16's renamed middleware: optimistic cookie check only
components/
  ui/                      shadcn primitives (generated, don't hand-edit upstream files)
  app/                     shell, nav, page-header, empty/error states,
                           create-project-dialog, create-project-form,
                           project-card, google-drive-file-picker
  auth/                    better-auth-ui components (generated)
  providers.tsx            QueryClient + AuthProvider (client boundary)
lib/
  auth/client.ts           createAuthClient() — same-origin, default basePath /api/auth
  auth/server.ts           getSession(), requireSession(), getAccessToken()
  api/server.ts            apiFetch(), parse with zod, error normalisation
  api/endpoints.ts         typed endpoint registry (the BFF allowlist)
  api/redirect.ts          host allowlist for upstream 3xx (OAuth start)
  api/callback-url.ts      the redirect_uri both hops must agree on
  api/connections.ts       RSC read of the caller's connections
  api/projects.ts          RSC read of the caller's projects (upstream `/jobs/`)
  api/schemas/             zod schemas for upstream payloads
  projects.ts              input/output registries, field controls, draft builder
                           (client-safe)
  connections.ts           provider + category registry, grouping helpers
  env.ts                   zod-validated env, server/public split
  errors.ts                ApiError, error mapping, safe messages
  redirect.ts              safeRedirect() — same-origin relative paths only
  csp.ts                   nonce-based Content-Security-Policy (pure, unit-tested)
  jwt.ts                   unverified `exp` read for the token page (never logs)
  connection-notice.ts     callback status → fixed user copy (never echoes input)
  oauth-popup.ts           popup cookie/message constants shared with the BFF
  nav.ts                   nav registry (Home, Projects, Connections, API token)
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
2. **The JWT stays server-side, with one explicit exception.** It is never put in props, RSC
   payloads, logs, or error messages. The only path to the browser is `POST /api/token`,
   reached from the signed-in `/api-token` page: POST-only (so it never lands in a URL,
   history, or prefetch), same-origin checked, `cache-control: no-store`, minted per
   request, held in page memory only, and never logged or persisted. Mint it, use it,
   drop it.
   **Second, narrower exception — the Google Picker.** Google's Picker runs in the browser
   and needs a Google OAuth token, so `POST /api/backend/connections/gdrive/access-token`
   relays `{"conn_id"}` to the API and returns that connection's `access_token` (scope
   `drive.file`). It is scoped to one provider's files, fetched per Picker open, kept in the
   click handler's local scope only, `no-store`, and never logged, stored, or put in a URL.
   It is not our JWT and grants nothing else in this app.
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
  session; POST is not routed — a bare 404.) *Superseded 2026-11-15 by the explicit
  `/api-token` page below; the BFF still never exposes one.*
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
  only — Home and Connections. `/dashboard` is kept as a redirect to `/home`. *(Third
  destination — API token — added 2026-11-15.)*
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
- **2026-11-14** — Hard scope rule (§0): agents and humans work only inside this
  repository. Harness-managed scratch (screenshots, command output) is the sole, write-only
  exception; anything else outside the root is out of bounds, and ambiguity means asking.
- **2026-11-14** — `GET /oauth/youtube/callback` on the API service is **not reachable by
  the browser**: it requires a Bearer JWT (impossible on a top-level redirect) and a
  UUID `state`, while `/connect/youtube` emits the non-UUID auth user id. The YouTube flow
  therefore stops at the callback. Two options are recorded in `docs/api-inventory.md`:
  route the callback through the BFF (preferred, keeps the browser same-origin) or make the
  callback token-free upstream. Not implemented yet — it depends on Google's registered
  `redirect_uri` and the API's state format.
- **2026-11-14** — The API service was refactored: `/connect/:provider` and
  `/oauth/:provider/callback` are gone (`404`). It now exposes
  `POST /connections/{provider}/start`, `POST /connections/{provider}/complete` and
  `GET /connections/`, all Bearer-protected. `redirect_uri` is validated per request
  against an upstream allowlist, and our BFF callback
  (`http://localhost:3000/api/backend/oauth/youtube/callback`) is accepted — the decoupled
  shape we asked for. The current `/api/backend/connect/:provider` route is therefore
  **broken** (`502`). Recorded in `docs/api-inventory.md`.
- **2026-11-14** — `connections/{provider}/*` take their parameters in the **body**:
  `start` and `complete` both a JSON object. The shape churned three times in one day
  (query params → string body → object body, with `state` moving from the user id to a
  random 128-bit value and `complete` moving from `500` to `200 {"connected":false}` on
  failure). Treat the API as live and re-probe before wiring a caller;
  `docs/api-inventory.md` records the current contract with timestamps.
- **2026-11-14** — BFF rewritten for the refactored API. One registry
  (`lib/api/endpoints.ts`) drives three kinds: `json`, `oauth-start`, `oauth-complete`.
  The Connect anchor stays a GET (plain anchor, real navigation) and the BFF issues the
  upstream POST; the provider callback mints the JWT server-side and always answers with a
  `303` into `/connections`, never JSON. `iss` falls back to the provider's configured
  issuer because the API requires it and plain OAuth callbacks omit it. The connections
  list is proxied and validated but not yet rendered — the item shape is unknown. Remaining
  blocker: Google's client still authorizes only
  `http://localhost:8000/oauth/youtube/callback`, so consent answers
  `redirect_uri_mismatch` for our URI.
- **2026-11-14** — `GET /connections/` returns `[{ "id": "<connection uuid>", "type": "<provider id>" }]`
  — the discriminator is `type`, not `provider`, and there is no channel metadata. Verified
  against a real YouTube connection. `/connections` therefore reads the list server-side via
  `lib/api/connections.ts` (no HTTP hop through our own BFF) and shows "Connected" +
  "Reconnect"; a failed list read is logged and treated as empty so the page still renders.
- **2026-11-14** — `/connections` is organised for **multiple accounts per provider**:
  category tabs (Socials, Storage) in `lib/connections.ts`, one card per provider listing every
  account attached to it, and an "Add another account" action once one exists. Tabs are plain
  links read from `?tab=` and validated against the registry (unknown → first category), so the
  page stays a server component with no client state. The list item carries no channel
  metadata, so each account row is labelled with the first segment of its connection id — the
  only stable identifier upstream gives us. Storage has no providers yet and renders an empty
  state. Both the grouping by `type` and the tab counts are pure helpers in `lib/connections.ts`
  and unit-tested. The provider grid uses `items-start`, so a card is exactly as tall as its
  account list: equal-height rows left a dead region (measured ~200px with 2 accounts beside 6)
  because account count is user data, not design. Every card reserves the same 100px account
  band — two rows, or a "No accounts connected" placeholder — the description is clamped to two
  fixed lines, and the footer label is one truncated line, so cards in a row stay the same
  height regardless of account count. Above two accounts the list scrolls inside the card; it
  is focusable whenever it scrolls, because a region that only responds to the mouse fails
  WCAG 2.1.1. The band is flush with the footer — the card gap above it is cancelled with
  `-mt-4`, and the band carries only a top border so there is one hairline, not two. Provider
  descriptions stay under ~30 characters so they fit two lines at the three-column width;
  badge width differs between connected and unconnected cards, so the unconnected column is
  the narrower one to design against.
- **2026-11-14** — `app/(app)/layout.tsx` awaits `connection()` before rendering the shell.
  The shell imports better-auth's client, whose store reads `Date.now()`; under
  cacheComponents that is an unstable value if the subtree is ever prerendered, and dev
  reports it as a blocking-prerender error. The area is session-gated, so request-time
  rendering is correct rather than a workaround.
- **2026-11-15** — The auth service now issues **UUIDv4** ids (`user.id`, `session.id`,
  `session.userId`); the owner also cleared its database, so every id recorded in earlier
  entries and probe logs is historical. Verified on a fresh account through this app's
  proxy (`ec33cdc2-44bf-4310-a85c-5e362510657c`). `lib/auth/server.ts` validates both ids as
  `z.uuid()`, so a future generator change fails closed with a 502 instead of silently
  mis-keying identity. The API's connection ids were already UUIDs and are unchanged.
- **2026-11-15** — Added an **API token** destination after Connections (owner request) so a
  signed-in user can call the API service from a terminal. This is the first intentional
  exception to the BFF-only token rule: `POST /api/token` mints the JWT on demand, with a
  same-origin `Origin` check, `no-store`, and no logging. The page keeps it in React state
  only (never `localStorage`/`sessionStorage`/URL), masks it until Reveal, and shows its
  `exp`-derived expiry. GET and all other verbs are not exported, so minting cannot be
  triggered by a link or prefetch. The BFF itself still never returns a JWT.
- **2026-11-16** — Connect/Add account now opens the provider consent in a **popup**. The
  provider only redirects to the single registered `redirect_uri`, so the flow is signalled
  by a short-lived `ryld_oauth_popup` cookie (a per-flow UUID, `Max-Age=600`, `SameSite=Lax`)
  written by `components/app/connect-anchor.tsx` immediately before `window.open`. The
  callback reads a non-empty marker and answers `303 /connections/complete?...` instead of
  `/connections`, clearing the marker there. That page (`app/connections/complete`) posts a
  same-origin `ryld:oauth` message to the opener and closes itself, falling back to the
  normal `/connections?…` navigation after 800 ms if the browser refuses `window.close()`
  or there is no opener. `components/app/connections-oauth-listener.tsx` validates the
  message origin, maps the status through `connectionNotice()` (never echo), toasts, and
  calls `router.refresh()` so the new account appears without a reload. One anchor stays the
  control: modifier/middle clicks and a blocked popup keep the original full-page `303`, and
  a close-poll clears the marker (only for its own flow value) if the user abandons the
  popup. Verified in a real browser: the popup survives the Google cross-origin round trip
  with `window.opener` intact (no COOP on either side); a fake `code` produced the parent
  toast and left the list unchanged. Note for future testing: the browser-automation
  `navigate` call severs `window.opener`, so popups must be driven from inside.
- **2026-11-17** — Added **Projects** to the sidebar between Home and Connections
  (owner request). A project is a source plus a destination; the page has one card that
  submits `POST /api/backend/projects`, which rewrites to the API's `POST /jobs/` (trailing
  slash required; `/jobs` answers `307`). The API calls the resource a job, but nothing in
  this app does: routes, components, schemas, copy and the endpoint id all say project.
  Sources and destinations are registries (`lib/projects.ts`): each entry declares its
  `fields` and each field carries its own zod schema, so adding a source or destination
  grows the form without touching the form component. Today that is YouTube (one validated
  `url`) and S3 (no extra fields). `buildProjectDraft()` only copies fields the registry
  declares, and the BFF parses the body with the same schema before forwarding, so unknown
  keys never reach the API. Verified live 2026-11-17: `POST /jobs/` answers `201` with
  `{ input, output, id, status: "draft", source }`; malformed bodies are `422`; unknown
  output keys are dropped and an arbitrary host is accepted for `type: "youtube"`, so the
  form's YouTube host check is our own UX guard. The `json` BFF kind now forwards a
  validated request body and accepts any 2xx (the create answers `201`). JSON endpoints
  also answer **401 rather than redirecting** when the session is gone, because `fetch`
  follows a 307 transparently and would hand the caller a sign-in page as success;
  top-level OAuth navigations still redirect. Project creation is deliberately not listed
  in the UI yet — the page only creates.
- **2026-11-17** — Added **Google Drive** (`gdrive`) under the **Storage** tab (owner request),
  as the first provider that is not a social account. The registry entry alone is enough on
  our side: `lib/api/endpoints.ts` generates `/connections/gdrive/start` and
  `/oauth/gdrive/callback` per provider, with `accounts.google.com` as the only redirect host
  and `https://accounts.google.com` as the fallback issuer. Verified live 2026-11-17: with
  `redirect_uri=http://localhost:3000/api/backend/oauth/gdrive/callback` the API answers
  `307` to `accounts.google.com` with scope `https://www.googleapis.com/auth/drive.file`, and
  `complete` with a fake code answers `200 {"connected":false}`. A first probe the same day
  had been rejected with `400 invalid redirect uri`, so the API allowlist was extended in
  between. The next blocker was Google's OAuth client not listing our callback
  (`Error 400: redirect_uri_mismatch`); **resolved later the same day** — see the Drive
  Projects entry below. See `docs/api-inventory.md`.
- **2026-11-17** — Added **Google Drive as a Projects source**, with Google's Picker as the
  file chooser (owner request). `lib/projects.ts` grew a `control` discriminator on every
  field — `text` (uses `inputType`), `gdrive-account`, `gdrive-file` — so the form renders a
  kind from its registry entry alone and a new source or destination never touches the form
  component. A Drive project is `{type, conn_id, file_id}`; `conn_id` defaults to the first
  connected Drive account (`initialFieldValues`), and changing the account clears the picked
  file so an id from another account cannot be submitted. The Picker is opened per click
  from `components/app/google-drive-file-picker.tsx`: `api.js` is appended dynamically
  (`gapi.load("picker")`), then `PickerBuilder` gets `setOAuthToken` (from the new
  `POST /api/backend/connections/gdrive/access-token`), `setDeveloperKey` and `setAppId`
  (both from the new `GET /api/backend/connections/gdrive/config`), with
  `DocsView(ViewId.DOCS).setMode(LIST)`. **This is the second token exception in §5.2** and
  the narrower one: it is Google's `drive.file` token, not our JWT, fetched per open,
  memory-only, `no-store`, never logged. `project_number` is a number upstream and is
  normalised to a string because `setAppId` takes one. CSP gained exactly one host —
  `frame-src https://docs.google.com` — because the Picker renders in an iframe; the script
  needs no host thanks to `strict-dynamic`, and `script-src` still has no `unsafe-inline`.
  Verified live 2026-11-17: config `200`, access-token `200`, unknown connection `502`,
  invalid body `400`, anonymous `401`, wrong verbs `404`; a Drive project created `201` and
  was deleted; the token carries exactly `drive.file` and answers `{"files":[]}` until the
  Picker grants a file. The form shows "Choose a file." when submitting without one and
  drops the error when the source changes. Not verifiable in automation: picking a file
  needs a browser signed into the connected Google account, so the Picker iframe renders
  Google's sign-in page instead. See `docs/api-inventory.md`.
- **2026-11-20** — Creating a project moved from an inline card to a **dialog** (owner
  request). `/projects` now shows the page header with one `+ Create project` button in its
  actions slot; the button is the `DialogTrigger`, so the form is no longer permanent page
  furniture and the page has room for the project list that comes next. `CreateProjectForm`
  owns no chrome (no card, no title): it renders fields, the inline error alert and a
  right-aligned submit, and reports success through `onCreated(id)`, which closes the dialog
  and toasts `Project created` with the reference. `DialogTitle`/`DialogDescription` carry
  the copy that used to be the card header, so the dialog is labelled for assistive tech.
  The content is `max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl`: the Drive variant
  is taller than a short viewport, and clipping the submit button would be worse than
  scrolling. Radix unmounts the content on close, so a reopened dialog always starts from a
  clean draft. `components/ui/dialog.tsx` is the registry-generated shadcn component
  (`bunx shadcn@latest add dialog`, style `radix-nova`) — no dependency was added, `radix-ui`
  already provides it. Verified in the browser 2026-11-20: the trigger opens a centred,
  focus-trapping dialog; Drive validation shows "Choose a file." without closing; Escape and
  the X close it and return focus to the trigger; reopening resets Source to YouTube; and a
  real creation closed the dialog and toasted the reference.
- **2026-11-20** — `/projects` now **lists projects as cards**, which supersedes the
  "creation is deliberately not listed yet" note from 2026-11-17. The read is server-side
  (`lib/api/projects.ts` → `GET /jobs/`, validated by the new `projectsListSchema`) exactly
  like the connections list, so no HTTP hop goes back through our own BFF and the JWT never
  leaves the server. `project-card.tsx` derives everything from the registries: the source
  kind supplies the icon and title, the destination kind the "→ S3 storage" line, and
  `summarizeProjectInput()` renders the stored fields the kind declares (drops unknown keys,
  empty strings and non-strings), so a new provider needs no card change. Status is an open
  string upstream — `projectStatusLabel()` gives the five we know copy, shows anything else
  verbatim, and only `draft` has been observed. Two judgement calls worth keeping: a failed
  list renders an error line rather than the empty state (never claim "no projects" when the
  read failed), and the grid is `md:grid-cols-2` — two columns keep a full video URL on one
  line, whereas three clipped it at ~290px. Cards stay in upstream order because the payload
  carries no timestamp to sort by. Creating in the dialog calls `router.refresh()` so the new
  card appears immediately. Verified live 2026-11-20: empty state, then a real creation
  produced a card with `Draft`, the URL row and the reference, and the test project was
  deleted afterwards by its exact id.
- **2026-11-20** — Added **YouTube as a Projects destination** (owner request), exposing the
  upload options the API echoes on creation. `lib/projects.ts` grew a richer field model: a
  field now declares a `control` (`text`, `textarea`, `select`, `switch`, `datetime`,
  `connection-account`, `gdrive-file`), `options`, `provider`, `defaultValue`, `group` and an
  optional `layout`, plus a `schema` that is used by the form *and* the BFF. Each schema
  accepts the form's representation and the wire representation and normalises to the wire
  one, so the browser's `projectCreateSchema` output is what the BFF parses again. The
  connect-account control replaced the Drive-only `gdrive-account` one and now serves both
  `conn_id` fields; the page passes *all* connections, not just Drive ones. The dialog
  (`sm:max-w-2xl`) renders each side's fields in registry order, a heading per `group`
  (Details, Playback, Audience) and a two-column grid whose spans come from `fieldLayout()`;
  toggles render as a horizontal row whose label side also toggles the switch, because a
  `<label for>` cannot activate a button. S3 remains the first output kind (default
  selection); YouTube is second. Category ids and labels live in `YOUTUBE_CATEGORIES`.
  `GET /jobs/options` and `/jobs/categories` answer `422` for every parameter shape tried, so
  the create response is the option set we build from. Verified in the browser 2026-11-20:
  the dialog renders all twelve options plus the account picker with the API defaults
  (private, 22, embeddable, public stats, not made for kids, altered content unset), an empty
  URL shows "Paste a video link." without firing a request, and a real creation posted the
  expected body (`tags` as an array, empty text as `null`) and rendered a `YouTube → YouTube`
  card; that job was deleted by its exact id. Created jobs from earlier probing were left
  alone.
- **2026-11-21** — Upstream added a top-level **`submit`** boolean to `POST /jobs/`: `true`
  creates the project as `pending`, `false`/omitted as `draft`. The create dialog now ends in
  **`Save as draft`** (outline) and **`Submit`**, which post the same payload and differ only
  in `submit`; `buildProjectDraft()` always sends the flag explicitly, and
  `projectCreateSchema` normalises it to a boolean (`z.boolean().default(false)`) so the BFF
  forwards one shape. Enter picks the first button, which is the draft one, because the API
  cannot undo a submission: `DELETE /jobs/{id}` answers `409` for anything not in `draft`.
  The toast and the dialog copy distinguish the two outcomes, and `pending` joined
  `projectStatusLabel()`. Verified upstream 2026-11-21: `submit: true` → `201 pending`,
  `false`/omitted → `201 draft`, `"true"` is coerced upstream (we never send a string), and a
  delete of a pending project answers `409`. Two probe projects created with `submit: true`
  remain upstream as `pending` because they can no longer be deleted — they are recorded
  here rather than worked around.
- **2026-11-21** — A **processed project reports a `source`**, which supersedes the assumption
  that `source` stays `null`. A submitted `youtube → s3` project moved `pending` →
  `completed`, and the API filled `source` with
  `{title, playlist, poster, thumbnails, captions, chapters, type: "hls"}` — six storage keys
  under one output prefix plus the video title, not URLs, so nothing is linkified (there is no
  bucket in `output` to resolve them against). `PROJECT_SOURCE_KINDS` + `summarizeProjectSource`
  render those rows under an `HLS stream` heading on the card, only when `source` is present,
  so a draft keeps its small card. `projectSchema` deliberately validates only
  `{type: string}` and lets every other key through (`catchall`), because the result kinds are
  upstream's vocabulary and a new one must not fail the whole projects list; an unregistered
  kind renders no rows. The same probe showed `failed` is a terminal status too, and that a
  `completed` or `failed` project answers `409` to `DELETE` just like `pending` — only `draft`
  is deletable, so the two earlier probe projects still cannot be removed.

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
