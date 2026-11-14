# API service inventory

Last verified **2026-11-14 13:46 UTC** against `http://localhost:8000` (FastAPI on uvicorn).
Values here are observations, not assumptions — re-verify before changing the BFF.

> **The service is being edited live.** Three different shapes were observed on 2026-11-14
> alone:
>
> | UTC | `start` input | `complete` input | unusable `state` |
> | --- | --- | --- | --- |
> | 12:53 | query param | query params | `500` |
> | 13:19 | bare JSON string body | JSON object body | `500` |
> | 13:46 | JSON object body | JSON object body | `200 {"connected":false}` |
>
> `/connect/:provider` and `/oauth/:provider/callback` were removed entirely in the same
> refactor (`404`). Re-probe before wiring any caller; do not trust a previous pass.

## Transport

| Concern | Verified behaviour |
| --- | --- |
| Base URL (dev) | `http://localhost:8000` |
| Auth | `Authorization: Bearer <jwt>` — minted server-side from the auth service's `GET /api/auth/token` |
| Missing token | `401` + `www-authenticate: Bearer`, body `{"detail":"Missing bearer token"}` |
| Unknown route | `404` + `{"detail":"Not Found"}` |
| Schema | `/openapi.json` is **disabled** (404). Endpoints must be learned by probing. |
| CORS | Enabled, echoes `http://localhost:3000` with `access-control-allow-credentials: true`. Irrelevant: the browser never calls this service directly. |
| Error envelope | FastAPI default `{"detail": ...}` — a string for 400/401/404/405, an array for 422 validation |
| Unhandled errors | `500` + `text/plain` `Internal Server Error`; no traceback leaked. None observed at 13:46. |

Status codes are the only map of the app: `404` no route · `405` route exists, wrong verb ·
`422` route + verb exist, request shape wrong (read `detail` for the schema) · `401` behind
the auth dependency · `307` → trailing slash means a router is mounted at that prefix.

## Endpoints

### `POST /connections/{provider}/start`

Starts the OAuth flow. `{provider}` is a literal, case-sensitive value: only `youtube`
exists (`google`, `YouTube`, `youtube-music`, `evil` → `404`).

The body is a **JSON object** with one required field:

```http
POST /connections/youtube/start
Authorization: Bearer <jwt>
Content-Type: application/json

{"redirect_uri": "http://localhost:3000/api/backend/oauth/youtube/callback"}
```

| Request | Result |
| --- | --- |
| Bearer + object body, allowlisted URI | `307` + **empty body** + `location: https://accounts.google.com/...` |
| Bearer + `https://evil.example.com/cb` | `400` + `{"detail":"invalid redirect uri"}` |
| Bearer + `http://localhost:8000/oauth/youtube/callback` (the old API callback) | `400` — no longer registered |
| Bearer + `https://localhost:3000/api/backend/...` (https variant of ours) | `400` — scheme must match exactly |
| Bearer + bare JSON **string** body `"http://…"` | `422` — `loc: ["body","redirect_uri"]`, `"Field required"` |
| Bearer + **query** `?redirect_uri=…`, no body | `422` — same `["body","redirect_uri"]` entry; **the query is ignored** |
| no Bearer | `401` + `{"detail":"Missing bearer token"}` |
| `GET` | `405` |
| unknown provider | `404` |

Accepted `redirect_uri`: `http://localhost:3000/api/backend/oauth/youtube/callback` — i.e.
**our** BFF callback (Option A). The allowlist is exact: scheme, host and port all matter.

The success redirect is:

```http
location: https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=8019…apps.googleusercontent.com
  &redirect_uri=http://localhost:3000/api/backend/oauth/youtube/callback
  &response_type=code
  &scope=https://www.googleapis.com/auth/youtube
  &state=<32 hex chars>
  &access_type=offline
  &prompt=consent
```

- **`state` is now a random 128-bit value** (`^[0-9a-f]{32}$`, different on every call), not
  the auth user id. The earlier concern is resolved upstream.
- **The `307` has an empty body** — the caller must read `Location`, not the payload.

### `POST /connections/{provider}/complete`

The code exchange. Body is a JSON object with five required string fields:

```http
POST /connections/youtube/complete
Authorization: Bearer <jwt>
Content-Type: application/json

{"code": "…", "state": "…", "iss": "https://accounts.google.com",
 "scope": "https://www.googleapis.com/auth/youtube", "redirect_uri": "…"}
```

| Request | Result |
| --- | --- |
| any missing field | `422` — one entry per field, `loc: ["body", <field>]` |
| full **query** string, empty body | `422` — the same five `["body", …]` entries; **the query is ignored** |
| non-allowlisted `redirect_uri` | `400` + `{"detail":"invalid redirect uri"}` |
| **any** unusable `state` (real-but-unspent + fake code, unknown UUID, garbage, replay) | `200` + `{"connected":false}` |
| `error=access_denied`, no `code` (user cancelled consent) | `422` — `code` is always required |
| no Bearer | `401` + `{"detail":"Missing bearer token"}` |

Verified 2026-11-14 13:46 UTC: the earlier `500` on a bad `state` is gone.

**The failure surface is now uninformative.** Every failure mode — unknown state, expired
state, cancelled consent, failed Google exchange — collapses into the same `200`
`{"connected":false}`. Consequences for us:

- the BFF callback cannot tell "user cancelled" from "we have a bug", so the UI can only
  show one generic error;
- nothing in monitoring or logs would reveal that every exchange is failing;
- the single-use and expiry properties of `state` are **unverifiable from outside**: a
  consumed state and an unconsumed one return the same response. Likewise `iss` validation
  is unproven — the fake code fails before any issuer check we can observe.

Ask upstream for a machine-readable reason (`{"connected":false,"reason":"state_invalid"}`)
and `4xx` for client-caused failures.

### `GET /connections/`

Lists the caller's connections. **Trailing slash matters**: `/connections` answers
`307` → `/connections/`. Only `GET` is routed: `POST`/`PUT`/`PATCH`/`DELETE` → `405`.

| Request | Result |
| --- | --- |
| no Bearer | `401` + `{"detail":"Missing bearer token"}` |
| Bearer | `200` + `[]` for an account with no connections |

The item schema is unknown until a connection actually exists — we cannot create one until
a real consent completes. This is the endpoint that lets `/connections` render "Connected"
instead of "Connect".

`DELETE /connections/{provider}` → `404`, so there is no disconnect endpoint yet.

## Probed and absent

`404` for `/`, `/health`, `/me`, `/connect/youtube`, `/oauth/youtube/callback`,
`/connections/youtube` (every method), `/connect`, `/auth/me`.

`/users/{id}` exists (`422` when `{id}` is not a UUID), so the upstream user resource is
keyed by UUID — the auth service's user ids are not UUIDs. Not used by this repo yet.

## Upstream OAuth client (resolved 2026-11-14)

Google accepts the consent URL: immediately after the redirect, the browser lands on
Google's sign-in screen ("to continue to rayload"), so `redirect_uri_mismatch` is gone. The
app display name configured on the OAuth client is **rayload**, not Ryld — worth aligning
for user-facing consent.

## Frontend contract

**Current state: broken by the refactor.** `/api/backend/connect/:provider` still forwards
to `GET {API_URL}/connect/:provider`, which now returns `404`; the BFF maps that to
`502 UPSTREAM` and the Connect card dead-ends. Verified 2026-11-14.

Target contract:

| Browser URL | Upstream | Behaviour |
| --- | --- | --- |
| `POST /api/backend/connections/youtube/start` | `POST {API_URL}/connections/youtube/start` with body `{"redirect_uri":"<our callback>"}` | Mints the JWT, `redirect: "manual"`, validates `Location` host, `303`s the browser to Google. |
| `GET /api/backend/oauth/youtube/callback` | `POST {API_URL}/connections/youtube/complete` with the five-field object | Google's `redirect_uri`. Requires the session cookie (survives a cross-site top-level GET under `SameSite=Lax`), mints the JWT, forwards `code/state/iss/scope/redirect_uri`, then `303`s to `/connections?connected=youtube` (on `connected:true`) or `?error=…`. |
| `GET /api/backend/connections` | `GET {API_URL}/connections/` | Lists connections so the cards can show "Connected". |

Notes: the browser never reaches the API origin; the JWT stays server-side in both
directions. Because the callback is a top-level navigation it must never return JSON — the
BFF owns the user-facing redirect.

## Open questions

1. What does `complete` return on **success**? Presumably `{"connected":true}`, plus
   possibly account metadata. Unverifiable until a real consent completes.
2. What is an item in `GET /connections/`? Needed to render "Connected" and the account
   label.
3. Can `complete` report *why* it failed instead of a bare `connected:false`?
4. Does `complete` validate `iss`? And is the `state` bound to the user who started the
   flow? Neither is observable while all failures return `200 false`.
5. Is a disconnect endpoint planned? `DELETE /connections/{provider}` is `404` today.
6. Are there other providers besides YouTube? Only `youtube` resolves today; the UI reads
   `lib/connections.ts`, and each provider needs a BFF allowlist entry plus its
   `allowedRedirectHosts`.
