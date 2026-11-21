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
| Bearer | `200` + array of connections |

Item shape, captured 2026-11-14 from a real YouTube connection:

```json
[{ "id": "7eb3f330-54cf-476b-a62c-2d5676bc8a59", "type": "youtube" }]
```

- `type` — **not** `provider` — is the discriminator, and it matches
  `ConnectionProvider.id`.
- `id` is the connection's UUID, not the provider's.
- No channel metadata, scopes or timestamps are exposed, so the card can say
  "Connected" but cannot name the channel.

This is the endpoint that drives the "Connected" state on `/connections`.

`DELETE /connections/{provider}` → `404`, so there is no disconnect endpoint yet.

## Probed and absent

`404` for `/`, `/health`, `/me`, `/connect/youtube`, `/oauth/youtube/callback`,
`/connections/youtube` (every method), `/connect`, `/auth/me`.

`/users/{id}` exists and returns `422` when `{id}` is not a UUID. As of 2026-11-15 the auth
service issues **UUIDv4 user ids** (verified via `GET /api/auth/get-session` through our proxy:
`user.id` = `session.userId` = `ec33cdc2-44bf-4310-a85c-5e362510657c`), so both services now key
users on the same shape. Not used by this repo yet.

## Upstream OAuth client

Google accepted the **old** API callback (`http://localhost:8000/oauth/youtube/callback`)
through 2026-11-14, and the app display name on the client is **rayload**, not Ryld — worth
aligning for consent copy.

That client does **not** list our BFF callback. Asking it to authorize
`http://localhost:3000/api/backend/oauth/youtube/callback` now returns Google's
`Access blocked … Error 400: redirect_uri_mismatch` page (verified in the browser
2026-11-14 14:05 UTC). Add that URI to the client's authorized redirect URIs; it is the
only outstanding change for the flow to reach the consent screen.

## Google Drive (`gdrive`, probed 2026-11-17)

The provider **exists upstream** and, as of the second probe on 2026-11-17, its redirect
allowlist **accepts our BFF callback**:

| Request | Result |
| --- | --- |
| `POST /connections/gdrive/start` + `{"redirect_uri":"http://localhost:3000/api/backend/oauth/gdrive/callback"}` | `307` + `location: https://accounts.google.com/o/oauth2/v2/auth?…&redirect_uri=http://localhost:3000/api/backend/oauth/gdrive/callback&scope=https://www.googleapis.com/auth/drive.file&state=<32 hex>` |
| same call with the `youtube` callback or any non-allowlisted URI | `400` `{"detail":"invalid redirect uri"}` — still exact per provider |
| `POST /connections/gdrive/complete` with a fake code/state | `200` `{"connected":false}` (same uninformative failure surface as youtube) |
| other provider names (`google-drive`, `google_drive`, `drive`, `googledrive`, `vimeo`, `dropbox`, `s3`) | `404` |

An earlier probe the same day returned `400 "invalid redirect uri"` for every gdrive
callback; the API allowlist was updated between the two. Driving the UI flow later that day
stopped on Google's `Error 400: redirect_uri_mismatch`, naming
`http://localhost:3000/api/backend/oauth/gdrive/callback`. **Resolved 2026-11-17:** a real
gdrive connection now exists for the probe account
(`23d7949e-0f85-4a64-ab5b-a855e39fc3b5`) and `/connections/gdrive/access-token` mints a
Google token for it with the `drive.file` scope, so Google's client lists the callback and
the whole popup flow completes.

The UI entry lives in `lib/connections.ts` (`gdrive`, filed under `storage`) and the BFF
paths are generated: `/api/backend/connections/gdrive/start` and
`/api/backend/oauth/gdrive/callback`.

## Frontend contract (implemented 2026-11-14)

Registry: `lib/api/endpoints.ts`. Handler: `app/api/backend/[...path]/route.ts`.
Verified against the dev server at 14:04 UTC:

| Browser call | Upstream | Behaviour |
| --- | --- | --- |
| `GET /api/backend/connections/youtube/start` | `POST /connections/youtube/start` with `{"redirect_uri": "<origin>/api/backend/oauth/youtube/callback"}` | `303` to the consent screen after the `Location` host check; anonymous → `307` to sign-in; unknown provider or traversal → `404` |
| `GET /api/backend/oauth/youtube/callback` | `POST /connections/youtube/complete` with `code/state/iss/scope/redirect_uri` | `303` to `/connections?connected=youtube` or `?error=…`; never JSON. With a non-empty `ryld_oauth_popup` cookie it answers `/connections/complete?…` instead and clears the cookie, so the popup can message its opener and close |
| `GET /api/backend/connections` | `GET /connections/` | validated JSON, `cache-control: no-store`; items are `{ id, type }` |

Callback outcomes verified: fake code → `?error=youtube_failed`; `error=access_denied` →
`?error=access_denied`; no session → `?error=session_expired`; missing params →
`?error=youtube_failed`.

`iss` is taken from the callback when present (OpenID Connect) and falls back to the
provider's `issuer` otherwise, because the API requires it but a plain OAuth callback does
not carry it.

The old `/api/backend/connect/:provider` is gone (`404`). Adding a provider still means one
registry entry plus its OAuth client credentials upstream — the BFF routes are generated.

`/connections` reads the list server-side (`lib/api/connections.ts`, no HTTP hop back through
the BFF). A failing list is logged and treated as empty so the page still renders.

Grouping is by `type` only: repeated items with the same `type` are treated as **separate
accounts of one provider**, never as an upsert. Whether `complete` appends a second account
or replaces the first is still unverified — the UI renders whatever the list contains.

## Projects (upstream `jobs`, verified 2026-11-17)

The UI calls these **projects**; the API calls the same resource **jobs**. The BFF
rewrites `POST /api/backend/projects` → `POST /jobs/`. The trailing slash matters:
`/jobs` answers `307` to `/jobs/`, which a server-side `fetch` would have to follow.

| Upstream call | Behaviour |
| --- | --- |
| `POST /jobs/` | `201` with the created object: `{"input":{"url":"…","type":"youtube"},"output":{"type":"s3"},"submit":false,"id":"<uuid>","status":"draft","source":null}`. Missing or invalid body → `422 {"detail":"Invalid request"}` (a fixed message with no field detail) |
| `GET /jobs/` | `200` with an array of the same shape |
| `DELETE /jobs/{id}` | `200 {"message":"Job deleted successfully"}` for a `draft`; `409 {"detail":"Job is not in 'draft' state"}` for anything already submitted (verified; not exposed by this app) |

`GET /jobs/` is what `/projects` renders: one card per item, read server-side. The payload
carries **no timestamp and no name**, so cards are ordered exactly as the API returns them
(insertion order, oldest first) and are identified by a short `id` prefix. `status` is an
open string; `draft`, `pending`, `completed` and `failed` have all been observed, and
`source` is `null` until a project finishes processing (see below).

Observed validation:

- `type` is required on both sides; omitting it is `422`.
- Unknown keys are accepted and dropped (`output: {"type":"s3","bucket":"x"}` returns only
  `type`).
- The URL is not checked against the provider: `{"type":"youtube","url":"https://example.com/v"}`
  is accepted and created. The form validates `youtube.com`/`youtu.be` itself; that is a
  UX guard, not an upstream requirement.
- Creation leaves `status: "draft"` unless `submit: true` is set (see below). No transition
  into processing has been observed on a draft.

### Draft vs submitted (verified 2026-11-21)

`POST /jobs/` gained a top-level `submit` boolean, next to `input` and `output`:

| Request | Response |
| --- | --- |
| `{"submit": true, …}` | `201`, `status: "pending"`, `submit: true` echoed |
| `{"submit": false, …}` | `201`, `status: "draft"`, `submit: false` echoed |
| `…` without `submit` | `201`, `status: "draft"`, `submit: false` echoed — the field defaults to false |
| `{"submit": "true", …}` | `201`, coerced to `true` upstream; this app only ever sends a real boolean |

`GET /jobs/` reflects the transition: a submitted project is listed as `pending`, not
`draft`. Deleting a submitted project answers `409 {"detail":"Job is not in 'draft'
state"}` — submission is **irreversible through the API**, which is why the create dialog
puts `Save as draft` before `Submit` and treats Enter as a draft. Both actions post the same
payload; they differ only in `submit`.

### The populated `source` (verified 2026-11-21)

`source` is `null` on creation and while a project is a draft or still running. A submitted
`youtube → s3` project moved `pending` → `completed`, and `GET /jobs/` then returned:

```json
"source": {
  "title": "Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)",
  "playlist": "79b7ea43c1fd45629757a55397e83a3b/master.m3u8",
  "poster": "79b7ea43c1fd45629757a55397e83a3b/thumbnail.jpg",
  "thumbnails": "79b7ea43c1fd45629757a55397e83a3b/storyboard.vtt",
  "captions": "79b7ea43c1fd45629757a55397e83a3b/captions.vtt",
  "chapters": "79b7ea43c1fd45629757a55397e83a3b/chapters.vtt",
  "type": "hls"
}
```

- `type` is the result discriminator; `hls` is the only value observed.
- The values are **storage keys relative to the output**, not URLs: no scheme, host or bucket,
  and `output` carries no bucket either. This app shows them verbatim and never builds links
  from them.
- A project that fails while processing reports `status: "failed"` and `source: null`.
- Submission stays irreversible after processing: `DELETE` on a `completed` or `failed`
  project answers the same `409 {"detail":"Job is not in 'draft' state"}` as `pending`. Only a
  `draft` can be removed through the API.
- The result kind is the API's vocabulary, not ours: a new `source.type` must not break the
  list, so the response schema validates only that `source` is an object with a non-empty
  `type` and the card renders rows from a `PROJECT_SOURCE_KINDS` registry entry it knows.

### Google Drive sources (verified 2026-11-17)

A Drive source is `{"type":"gdrive","conn_id":"<uuid>","file_id":"<Drive file id>"}`, so the
API can read the file with that connection's token. Verified live end to end through the BFF
with a throwaway file id:

| Call | Result |
| --- | --- |
| `POST /jobs/` + `{"input":{"type":"gdrive","conn_id":"23d7949e-…","file_id":"1AbCdEfGhIjKlMnOpQrStUvWxYz"},"output":{"type":"s3"}}` | `201` with `{"input":{"type":"gdrive","file_id":"…","conn_id":"…"},"output":{"type":"s3"},"id":"<uuid>","status":"draft","source":null}` (created job deleted afterwards) |
| same with `conn_id: ""`, a non-UUID `conn_id`, or a missing `file_id` | `422` |

The file id is **not** validated upstream at creation time — an invented id is accepted, so
the Picker's own list is what makes the id real. `conn_id` must be a uuid the caller owns;
an unknown one is accepted by `/jobs/` and can only fail later during processing.

### YouTube destinations (verified 2026-11-20)

A YouTube destination is `{"type":"youtube","conn_id":"<uuid>"}`. The API accepts the whole
upload-metadata block and **echoes every field back with its default** when it is omitted, so
those defaults are part of the contract and are what the create dialog starts from:

| Field | Default when omitted | Notes |
| --- | --- | --- |
| `title` | `null` | Up to 100 characters |
| `description` | `null` | Up to 5000 characters |
| `tags` | `null` | An array of strings, not a comma string |
| `category_id` | `"22"` | Assignable ids: 1, 2, 10, 15, 17, 19, 20, 22, 23, 24, 25, 26, 27, 28, 29 |
| `default_language` | `null` | Language code such as `en` or `en-US` |
| `privacy` | `"private"` | `private`, `unlisted` or `public` |
| `publish_at` | `null` | ISO instant |
| `embeddable` | `true` | |
| `public_stats_viewable` | `true` | |
| `made_for_kids` | `false` | |
| `contains_synthetic_media` | `null` | Tri-state: `true`, `false` or unset |
| `thumbnail_url` | `null` | |

Verified live 2026-11-20: `POST /jobs/` with
`{"input":{"type":"gdrive","conn_id":"…","file_id":"…"},"output":{"type":"youtube","conn_id":"…"}}`
answers `201` and echoes all twelve option fields with the defaults above. Sending every field
explicitly (title, description, tags, category `28`, language `en`, `unlisted`, `publish_at`,
booleans) also answers `201`, so the whole block round-trips. Every created job was deleted
afterwards by its exact id.

`GET /jobs/options` and `GET /jobs/categories` exist but answer `422 {"detail":"Invalid
request"}` for every parameter shape tried (`type`, `output_type`, `conn_id`, `provider`,
`connection_id`, …). The create response is the only observed option set, so the registry's
option lists come from there plus YouTube's documented assignable categories.

### Google Drive Picker credential endpoints (probing 2026-11-17)

Two Bearer-protected endpoints feed the Google Picker in the browser:

| Request | Result |
| --- | --- |
| `GET /connections/gdrive/config` | `200 {"api_key":"AIza…","project_number":801901239085}` — the Cloud project's browser key and its project number (the Picker wants that string as `appId`) |
| `POST /connections/gdrive/access-token` + `{"conn_id":"<uuid>"}` | `200 {"access_token":"ya29.…"}` |
| `POST /connections/gdrive/access-token` with an unknown (but valid) uuid | `404 {"detail":"Google Drive connection not found"}` |
| `POST` with a missing or non-UUID `conn_id` | `422` |
| `GET` on either, or `POST /config` | `405` |

The minted token was checked against `https://oauth2.googleapis.com/tokeninfo`:

- `scope` = `https://www.googleapis.com/auth/drive.file` (only files the app created or the
  user explicitly opened, which is why `GET /drive/v3/files` returns `{"files":[]}` until the
  Picker grants access),
- `aud` = the Cloud project's OAuth client (`801901239085-…apps.googleusercontent.com`),
- `exp` ≈ one hour after issue.

Both are exposed as explicit `json` entries in `lib/api/endpoints.ts`
(`connections.gdrive.config`, `connections.gdrive.access-token`), validated by
`gdriveConfigSchema` / `gdriveAccessTokenRequestSchema` / `gdriveAccessTokenSchema` in
`lib/api/schemas/connections.ts`, and answered `no-store`. Verified through the BFF:
authenticated config `200`, anonymous `401`, unknown connection `502`, invalid body `400`,
wrong verb `404`.

Note `project_number` is a **number** upstream and is normalised to a string by the schema,
because `PickerBuilder.setAppId` takes a string.

## Open questions

1. What does `complete` return on **success**? Presumably `{"connected":true}`, plus
   possibly account metadata. Unverifiable until a real consent completes.
2. Can `complete` report *why* it failed instead of a bare `connected:false`?
3. Does `complete` validate `iss`? And is the `state` bound to the user who started the
   flow? Neither is observable while all failures return `200 false`.
4. Is a disconnect endpoint planned? `DELETE /connections/{provider}` is `404` today.
5. Are there other providers besides YouTube? `youtube` and `gdrive` both resolve upstream;
   gdrive accepts our BFF callback (`307` to Google) and a real gdrive connection now exists
   for the probe account (2026-11-17), so Google's client accepts our
   `redirect_uri` too. Everything else probed is `404`. The UI reads
   `lib/connections.ts`, and each provider needs a BFF allowlist entry plus its
   `allowedRedirectHosts`.
6. Does `complete` add an account or replace the existing one for the same provider? The UI
   assumes add, since it renders every returned item.
7. Can an account be identified? Items carry no channel name, avatar, or email, so the UI
   labels accounts with the first segment of the connection id. Account metadata (and any
   `prompt=select_account` hint on the consent URL) is needed to let a user pick *which*
   account to add.
