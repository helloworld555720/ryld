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

## Endpoints

### `GET /connect/youtube`

Starts the YouTube OAuth flow. **GET only** — `POST` returns `405`.

With a valid JWT → `307 Temporary Redirect`:

```http
location: https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=8019…apps.googleusercontent.com
  &redirect_uri=http://localhost:8000/oauth/youtube/callback
  &response_type=code
  &scope=https://www.googleapis.com/auth/youtube
  &state=<auth user id>
  &access_type=offline
  &prompt=consent
```

Without a token → `401` (see above). With an expired/invalid JWT → `401`.

Notes for the frontend:

- The `state` is the **auth service user id**, not a random value. That is the API's
  design; we do not touch it.
- The browser must follow this redirect itself — the BFF must not fetch the consent page.
  The BFF therefore forwards the `Location` after validating its host.

## Probed and absent

`404` for `/`, `/health`, `/connections`, `/me`, `/connect`, `/auth/me`.

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

| Browser URL | Upstream | Behaviour |
| --- | --- | --- |
| `GET /api/backend/connect/youtube` | `GET {API_URL}/connect/youtube` | BFF mints the JWT, requests with `redirect: "manual"`, validates the `Location` host against `lib/connections.ts`, then returns `303` + `cache-control: no-store`. Unknown provider → `404` JSON; anonymous → `307` to sign-in. |

## Open questions

1. What URL does the OAuth callback redirect the browser to after consent? We need it to
   show a success/error state on `/connections`.
2. Is there a connections-list endpoint (to show "Connected" and offer Disconnect)?
3. Are there other providers besides YouTube? The UI reads `lib/connections.ts`; each new
   provider needs a BFF allowlist entry and its `allowedRedirectHosts`.
