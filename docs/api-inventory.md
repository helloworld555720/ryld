# API service inventory

Verified **2026-11-14** against `http://localhost:8000` (FastAPI on uvicorn).
Values here are observations, not assumptions — re-verify before changing the BFF.

## Transport

| Concern | Verified behaviour |
| --- | --- |
| Base URL (dev) | `http://localhost:8000` |
| Auth | `Authorization: Bearer <jwt>` — minted server-side from the auth service's `GET /api/auth/token` |
| Missing token | `401` + `www-authenticate: Bearer`, body `{"detail":"Missing bearer token"}` |
| Unknown route | `404` + `{"detail":"Not Found"}` |
| Schema | `/openapi.json` is **disabled** (404). Endpoints must be learned by probing. |
| CORS | Enabled, echoes `http://localhost:3000` with `access-control-allow-credentials: true`. Irrelevant: the browser never calls this service directly. |
| Error envelope | FastAPI default `{"detail": ...}` — a string for 401/404/405, an array for 422 validation |
| Unhandled errors | `500` + body `Internal Server Error` (plain text) — no traceback leaked |

> **The service was refactored on 2026-11-14.** `/connect/:provider` and
> `/oauth/:provider/callback` no longer exist (`404`). The flow is now
> `POST /connections/{provider}/start` → provider consent → `POST /connections/{provider}/complete`,
> with `redirect_uri` supplied per request. Everything below is the post-refactor contract.

## Endpoints

### `POST /connections/{provider}/start?redirect_uri=<url>`

Starts the OAuth flow. `redirect_uri` is a **required query parameter** — the API no longer
hardcodes its own callback, which is what we asked for.

| Request | Result |
| --- | --- |
| Bearer + allowlisted `redirect_uri` | `307` + `location: https://accounts.google.com/...` |
| Bearer + `https://evil.example.com/cb` | `401` + `{"detail":"invalid redirect uri"}` |
| Bearer + `http://localhost:8000/oauth/youtube/callback` (the old callback) | `401` + `{"detail":"invalid redirect uri"}` — it is no longer registered |
| no Bearer | `401` + `{"detail":"Missing bearer token"}` |
| unknown provider (`/connections/evil/start`) | `404` |
| `GET` | `405` |
| missing `redirect_uri` | `422` |

Accepted `redirect_uri`: `http://localhost:3000/api/backend/oauth/youtube/callback` — i.e.
**our** BFF callback (Option A). Verified 2026-11-14.

The success redirect is:

```http
location: https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=8019…apps.googleusercontent.com
  &redirect_uri=http://localhost:3000/api/backend/oauth/youtube/callback
  &response_type=code
  &scope=https://www.googleapis.com/auth/youtube
  &state=<auth user id>
  &access_type=offline
  &prompt=consent
```

- `state` is still the **auth service user id**, not a random single-use value. It is not
  a capability in this design (the Bearer is), but it is guessable and leaks the user id to
  Google and to every log that records a URL. Recommend `secrets.token_urlsafe(32)` stored
  server-side with the flow.
- Status-code nit: an invalid `redirect_uri` is a client error, so it should be `400`, not
  `401`. `401` implies "authenticate again", which is misleading.

### `POST /connections/{provider}/complete?code&state&iss&scope&redirect_uri`

The code exchange. All five query parameters are required.

| Request | Result |
| --- | --- |
| any missing query parameter | `422` listing each missing field |
| `state` = the user id emitted by `start` + fake `code` | **`500` Internal Server Error** |
| `state` = UUID + fake `code` | **`500` Internal Server Error** |
| `error=access_denied` and no `code` (user cancelled consent) | `422` — `code` is required |

Two open upstream defects:

1. **`500` on an unknown/unusable `state`.** No `state` the client can obtain today yields
   anything but a 500, so the flow still cannot complete. A rejected `state` should be
   `400`, and a cancelled consent should be accepted and reported, not `422`'d.
2. **The `state` mismatch persists.** `start` emits the auth user id; `complete` cannot use
   it. Same defect as before the refactor, now surfacing as a 500 instead of a 422.

### `GET /connections/`

Lists the caller's connections. **Trailing slash matters**: `/connections` answers
`307` → `/connections/`.

| Request | Result |
| --- | --- |
| no Bearer | `401` + `{"detail":"Missing bearer token"}` |
| Bearer | `200` + `[]` for a fresh account |

The item schema is unknown until a connection actually exists. This is the endpoint that
lets `/connections` render "Connected" instead of "Connect".

`DELETE /connections/{provider}` → `404`, so there is no disconnect endpoint yet.

## Probed and absent

`404` for `/`, `/health`, `/me`, `/connect/youtube`, `/oauth/youtube/callback`,
`/connections/youtube`, `/connect`, `/auth/me`. `PATCH /connections/` → `405`.

`/users/{id}` exists (`422` when `{id}` is not a UUID), so the upstream user resource is
keyed by UUID — the auth service's user ids are not UUIDs. Not used by this repo yet.

## Upstream OAuth client (resolved 2026-11-14)

Google now accepts the consent URL: immediately after the `303`, the browser lands on
Google's sign-in screen ("to continue to rayload"), so `redirect_uri_mismatch` is gone.
The app display name configured on the OAuth client is **rayload**, not Ryld — worth
aligning for user-facing consent.

The `state` parameter is still the **auth service user id**, not a random per-flow value.
That is the API service's design and we do not touch it, but an unpredictable `state`
validated against the session is the standard CSRF defence for an OAuth callback; flag it
to the API owner.

## Frontend contract

**Current state: broken by the refactor.** `/api/backend/connect/:provider` still forwards
to `GET {API_URL}/connect/:provider`, which now returns `404`; the BFF maps that to
`502 UPSTREAM` and the Connect card dead-ends. Verified 2026-11-14.

Target contract, now that the upstream takes a per-request `redirect_uri`:

| Browser URL | Upstream | Behaviour |
| --- | --- | --- |
| `POST /api/backend/connections/youtube/start` | `POST {API_URL}/connections/youtube/start?redirect_uri=<our callback>` | Mints the JWT, `redirect: "manual"`, validates `Location` host, `303`s the browser to Google. |
| `GET /api/backend/oauth/youtube/callback` | `POST {API_URL}/connections/youtube/complete?…` | Google's `redirect_uri`. Requires the session cookie (survives a cross-site top-level GET under `SameSite=Lax`), mints the JWT, forwards `code/state/iss/scope/redirect_uri`, then `303`s to `/connections?connected=youtube` or `?error=…`. |
| `GET /api/backend/connections` | `GET {API_URL}/connections/` | Lists connections so the cards can show "Connected". |

Notes: the browser never reaches the API origin; the JWT stays server-side in both
directions. Because the callback is a top-level navigation it must never return JSON — the
BFF owns the user-facing redirect.

## Open questions

1. What does `POST /connections/{provider}/complete` return on success, and why does it
   `500` instead of `400` on a `state` it cannot use? Until that is fixed the flow cannot
   complete end to end.
2. What is the shape of an item in `GET /connections/`? Needed to render "Connected" and
   the connected account's label.
3. Is a disconnect endpoint planned? `DELETE /connections/{provider}` is `404` today.
4. Are there other providers besides YouTube? The UI reads `lib/connections.ts`; each new
   provider needs a BFF allowlist entry and its `allowedRedirectHosts`.
