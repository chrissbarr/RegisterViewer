# Register Viewer API Reference

Base URL: `https://<your-domain>/api`

## Public HTTP Surface

Only documented routes under `/api/health`, `/api/health/email`, `/api/auth/*`, and `/api/projects*` are public API contract. PHP source files, Composer/vendor files, migrations, database files, config files, tests, and deployment internals under paths such as `/api/src`, `/api/vendor`, `/api/database`, and `/api/tests` are implementation details. Production deployments must deny those paths with `403`.

## Timestamp Contract

All API timestamps are UTC and use ISO 8601 second precision: `YYYY-MM-DDTHH:mm:ssZ`. Responses do not include fractional seconds.

## Caching

Every API response is `Cache-Control: no-store` unless documented otherwise. The default is applied at the response exit point, so it covers error responses and the health endpoints too; handlers that set an explicit `Cache-Control` pass through untouched. The sole cacheable response is `GET /api/projects/{id}` for unlisted projects (`private, max-age=60`, with `Vary: Origin, Authorization` so caches key on the requester).

## Health Endpoints

### API Health

```
GET /api/health
HEAD /api/health
```

Checks database connectivity, verifies required auth configuration, verifies every numbered migration in `api/database/migrations/` has been applied, and verifies the schema required by the current API code exists. The readiness check includes `JWT_SECRET`, `OTP_HASH_SECRET`, concurrency schema, and auth schema such as `projects.version`, `login_codes.code_verifier`, and `auth_rate_limits.*`.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "database": "ok",
  "migrations": "ready",
  "authConfig": {
    "jwt_secret": true,
    "otp_hash_secret": true
  },
  "schema": {
    "projects.version": true,
    "login_codes.code_verifier": true,
    "auth_rate_limits.scope": true
  },
  "appliedMigrations": [1, 2, 3, 4, 5],
  "pendingMigrations": [],
  "timestamp": "2026-05-10T00:00:00Z"
}
```

**Response `503 Service Unavailable` - `schema_not_ready`:**

Returned when the database is unavailable, another request holds the migration lock, the migration lock file cannot be opened, a migration fails, migration history does not match the deployed numbered SQL files, or required schema shape cannot be established. This response includes `Retry-After: 5`.

```json
{
  "error": "Service temporarily unavailable",
  "code": "schema_not_ready"
}
```

Normal API routes use the same pre-routing readiness gate and may return this `503` before route-specific validation or authentication.

**Response `503 Service Unavailable` - `config_not_ready`:**

Returned by `/api/health` when the database and schema are ready but required auth configuration is missing or too short.

```json
{
  "error": "Service temporarily unavailable",
  "code": "config_not_ready",
  "authConfig": {
    "jwt_secret": false,
    "otp_hash_secret": true
  },
  "timestamp": "2026-05-10T00:00:00Z"
}
```

### Email Health

```
GET /api/health/email
HEAD /api/health/email
```

Checks that the Resend API key is configured and the provider API is reachable. This endpoint is also behind the API schema readiness gate. The result is cached server-side for 5 minutes (failures included), so at most one live Resend API call is made per window; a health-state change can therefore be reported up to 5 minutes late.

## Authentication

The API uses JWT authentication for cloud project ownership. Obtain a JWT by completing the email OTP flow via `POST /api/auth/verify-code`, then send it on authenticated requests:

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

- **Algorithm:** HMAC-SHA256
- **Expiry:** 24 hours from issue
- **Claims:** `sub` (user ID), `email`, `iat`, `exp`, `jti` (token ID for revocation)
- **Scope:** Grants access to all projects owned by the authenticated user

### Ownership Model

- Cloud projects are owned by the user ID in the JWT `sub` claim.
- Create, list, update, delete, and visibility changes require a JWT for the owning user.
- Private project reads require the owning user's JWT.
- Unlisted project reads are public to anyone with the link. Supplying the owning user's JWT sets `isOwner: true` in the response.

---

## Authentication Endpoints

### Send Login Code

```
POST /api/auth/send-code
```

Sends a 6-digit OTP code to the provided email address.

**Auth:** Not required

**Request Body:**

```json
{
  "email": "user@example.com"
}
```

**Rate Limiting:**
- Global: max 30 OTP sends per minute across all users (returns `503`)
- Per-IP: max 5 sends per IP per 15 minutes (returns `429`)
- Per-email: max 3 codes per email per hour (returns `429`)

**Response `200 OK`:**

```json
{
  "ok": true
}
```

Always returns 200 regardless of whether the email was delivered, to prevent email enumeration.

**Errors:**

| Status | Reason |
|--------|--------|
| 400 | Invalid or missing email address |
| 429 | Too many requests (per-IP or per-email rate limit exceeded) |
| 503 | Global rate limit exceeded — try again later |

`503` also indicates the API auth configuration is unavailable, such as a missing or too-short `OTP_HASH_SECRET`.

---

### Verify Login Code

```
POST /api/auth/verify-code
```

Verifies a 6-digit OTP code and returns a JWT token.

**Auth:** Not required

**Request Body:**

```json
{
  "email": "user@example.com",
  "code": "123456"
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `email` | Yes | Email address the code was sent to |
| `code` | Yes | 6-digit OTP code |

**Rate Limiting:**
- Global: max 100 valid-format verification attempts per minute across all users (returns `503`)
- Per IP: max 30 valid-format verification attempts per 10-minute window (returns `429`)
- Per email: max 10 valid-format verification attempts per 10-minute window (returns `429`)
- Per active code: max 5 attempts before the code is locked out (returns the same `401` as an invalid or expired code)

**Code Expiry:** 10 minutes after generation. Single-use (marked used on success). Requesting a new code invalidates any previous unused code for that email.

**Response `200 OK`:**

```json
{
  "token": "eyJhbGc...",
  "user": {
    "id": 1,
    "email": "user@example.com"
  }
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| 400 | Invalid email or code format |
| 401 | Invalid or expired code |
| 429 | Too many verification attempts |
| 503 | Global rate limit exceeded — try again later |

`503` also indicates the API auth configuration is unavailable, such as a missing or too-short `OTP_HASH_SECRET`.

---

### Get Current User

```
GET /api/auth/me
```

Returns the authenticated user's profile.

**Auth:** Required (JWT only)

**Response `200 OK`:**

```json
{
  "user": {
    "id": 1,
    "email": "user@example.com"
  }
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| 401 | Missing or invalid JWT token |

---

### Logout

```
POST /api/auth/logout
```

Revokes the current JWT token. The token's `jti` is added to the `revoked_tokens` table, preventing reuse.

**Auth:** Required (JWT only)

**Request Body:** None

**Response:** `204 No Content` (empty body)

**Errors:**

| Status | Reason |
|--------|--------|
| 401 | Missing or invalid JWT token |

---

## Project Endpoints

### Create Project

```
POST /api/projects
```

Creates a new project and returns a cloud project URL. New projects default to private unless `visibility` is set to `unlisted`.

**Auth:** Required (JWT)

**Request Body:**

```jsonc
{
  "data": {
    "version": 1,                              // Required, must be 1
    "registers": [                             // Required, 1–256 registers
      {
        "name": "CTRL",                        // Required, 1–200 chars
        "width": 8,                            // Required, 1-128 bits
        "fields": [                            // Required, 0–64 fields
          {
            "name": "EN",                      // Required, 1–200 chars
            "type": "flag",                    // "flag"|"enum"|"integer"|"float"|"fixed-point"
            "msb": 0,                          // Required, integer from 0 to 127
            "lsb": 0,                          // Required, integer from 0 to 127
            "description": "Enable bit",        // Optional, max 500 chars
            "id": "field-1",                    // Optional
            "flagLabels": {                    // Optional for flag fields
              "clear": "Disabled",
              "set": "Enabled"
            }
          }
        ],
        "description": "Control register",     // Optional
        "offset": 0,                           // Optional, non-negative integer
        "id": "reg-1"                          // Optional
      }
    ],
    "registerValues": { "CTRL": "0xFF" },      // Required object, hex string values
    "project": {                               // Optional metadata
      "title": "My Project",                   // Optional, max 500 chars
      "description": "...",                    // Optional, max 500 chars
      "date": "2026-01-01",                   // Optional, max 500 chars
      "authorEmail": "user@example.com",       // Optional, max 500 chars
      "link": "https://example.com"            // Optional, max 500 chars
    },
    "addressUnitBits": 8                       // Optional: 8, 16, 32, 64, or 128
  },
  "visibility": "private"                      // Optional, default "private". "private"|"unlisted"
}
```

**Size limit:** 512 KB

**Project data validation:**

- Register and field names must be non-empty after trimming.
- Register widths must be `1` through `128`.
- Field `msb` and `lsb` must be integers from `0` through `127`, and `msb` must be greater than or equal to `lsb`.
- `flag` fields must be exactly 1 bit wide. Optional `flagLabels` must contain string `clear` and `set` labels.
- `enum` fields must include an `enumEntries` array with at most 256 entries. Each entry must include integer `value` and non-empty string `name`.
- `integer` fields may include `signedness`, which must be `unsigned`, `twos-complement`, or `sign-magnitude`.
- `float` fields must include `floatType`: `half` requires 16 bits, `single` requires 32 bits, and `double` requires 64 bits.
- `fixed-point` fields must include `qFormat` with non-negative integer `m` and `n`; `m + n` must equal the field width.
- Field ranges that extend beyond the owning register width are accepted when their bit indices remain within `0` through `127`. Overlapping fields and overlapping register address ranges are also accepted by the API and may be surfaced as non-blocking client warnings.

**Response `201 Created`:**

```json
{
  "id": "AbCdEfGhIjKl",
  "shareUrl": "https://www.registerviewer.com/#/p/AbCdEfGhIjKl",
  "createdAt": "2026-02-23T09:00:00Z",
  "version": 1
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| 400 | Invalid JSON, validation error, invalid visibility, payload too large |
| 401 | Missing or invalid Authorization header |
| 503 | Unable to generate unique ID (retry) |

---

### Get Project

```
GET /api/projects/{id}
```

Retrieves a project by its 12-character base62 ID.

**Auth:** Required for `private` projects. Not required for `unlisted` projects. Supplying the owning user's JWT marks the response with `isOwner: true`.

**Response `200 OK`:**

```json
{
  "id": "AbCdEfGhIjKl",
  "data": { "version": 1, "registers": [...], "registerValues": {...} },
  "createdAt": "2026-02-23T09:00:00Z",
  "updatedAt": "2026-02-23T09:00:00Z",
  "visibility": "unlisted",
  "version": 3,
  "isOwner": true
}
```

`version` is the current optimistic concurrency version. Pass this value in the `PUT` request body to update the project.

`visibility` is `private` or `unlisted`.

`isOwner` is `true` when the requesting user owns this project via JWT user ID, `false` otherwise.

**Cache-Control:**
- Private projects: `private, no-store`
- Unlisted projects: `private, max-age=60`

**Side effect:** Updates `lastAccessedAt` if stale >24 hours.

**Errors:**

| Status | Reason |
|--------|--------|
| 404 | Project not found, or private project without the owning user's JWT |

Private projects return 404 (not 401/403) to prevent information leakage.

---

### Update Project

```
PUT /api/projects/{id}
```

Replaces all project data and preserves the current visibility. Uses optimistic concurrency via a `version` field. Visibility changes must use `PATCH /api/projects/{id}`.

**Auth:** Required (JWT, must be owner)

**Request Body:** Project data plus a required `version` field:

```jsonc
{
  "version": 3,                                    // Required — client's last-known version
  "data": { /* same data schema as Create */ }
}
```

The `version` must match the server's current version. On success, the server increments the version atomically. A top-level `visibility` field is rejected with `400`; use the PATCH endpoint below instead.

**Size limit:** 512 KB

**Response `200 OK`:**

```json
{
  "id": "AbCdEfGhIjKl",
  "updatedAt": "2026-02-23T10:00:00Z",
  "version": 4
}
```

**Response `409 Conflict`** (version mismatch):

```json
{
  "error": "Project has been modified by another session",
  "code": "version_conflict",
  "currentVersion": 5
}
```

`error` is the human-readable sentence; `code` is the stable machine token (see
[Error Response Format](#error-response-format)); `currentVersion` is the
server's current data version. The client should fetch the latest version and
either merge or let the user choose.

**Errors:**

| Status | Reason |
|--------|--------|
| 400 | Invalid JSON, validation error, top-level visibility field, payload too large, missing/invalid version |
| 401 | Missing or invalid Authorization header |
| 404 | Project not found or not owner |
| 409 | Version conflict — another session updated the project |

---

### Patch Visibility

```
PATCH /api/projects/{id}
```

Updates only the project visibility without touching data or incrementing the project data version.

**Auth:** Required (JWT, must be owner)

**Request Body:**

```json
{
  "visibility": "unlisted"
}
```

The `visibility` field is required and must be `"private"` or `"unlisted"`.

**Response `200 OK`:**

```json
{
  "id": "AbCdEfGhIjKl",
  "updatedAt": "2026-02-23T10:00:00Z"
}
```

**Errors:**

| Status | Reason |
|--------|--------|
| 400 | Invalid JSON, missing visibility, invalid visibility value |
| 401 | Missing or invalid Authorization header |
| 404 | Project not found or not owner |

---

### Delete Project

```
DELETE /api/projects/{id}
```

Permanently deletes a project.

**Auth:** Required (JWT, must be owner)

**Response:** `204 No Content` (empty body)

**Errors:**

| Status | Reason |
|--------|--------|
| 401 | Missing or invalid Authorization header |
| 404 | Project not found or not owner |

---

### List Projects

```
GET /api/projects
```

Lists all projects owned by the authenticated user.

**Auth:** Required (JWT)

**Response `200 OK`:**

```json
{
  "projects": [
    {
      "id": "AbCdEfGhIjKl",
      "title": "My Project",
      "visibility": "private",
      "createdAt": "2026-02-23T09:00:00Z",
      "updatedAt": "2026-02-23T09:00:00Z",
      "version": 3
    }
  ]
}
```

**Cache-Control:** `private, no-store`

**Errors:**

| Status | Reason |
|--------|--------|
| 401 | Missing or invalid Authorization header |

---

## CORS

**Production origins:** The API sends CORS headers only when the request `Origin` exactly matches an entry in the PHP config `allowed_origins` array. The default `api/config.php` value is:

- `https://www.registerviewer.com`

Production deployments may override this in the server-only `api/config.production.php` file:

```php
'allowed_origins' => [
    'https://www.registerviewer.com',
],
```

`VITE_API_URL` does not configure CORS. It is a GitHub Actions/frontend build variable. Keep `VITE_API_URL`, `app_url`, and `allowed_origins` aligned to the same public HTTPS origin unless the deployment intentionally separates frontend and API origins.

**Development:** Any `localhost` or `127.0.0.1` origin is allowed when the API config `environment` is not `production`.

**Preflight:** `OPTIONS` requests from an allowed origin return `204` with CORS headers. Disallowed origins return `403`.

## Security Headers

All responses include:

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
X-Frame-Options: DENY
Content-Security-Policy: default-src 'none'
```

In production, HSTS is also sent:

```
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## Error Response Format

The standard error envelope is:

```json
{
  "error": "Human-readable error message",
  "code": "stable_machine_token",
  "currentVersion": 5
}
```

- `error` — **always present, always human-readable.** Safe to surface directly
  to users. Never carries a machine token.
- `code` — **optional** stable machine token for programmatic handling. Present
  only on the responses listed in the table below; clients should branch on
  `code` (or, for `version_conflict`, on the `currentVersion` field) rather than
  string-matching `error`, whose wording may change.
- Additional fields — endpoint-specific details may accompany the envelope. For
  example, the 409 version conflict adds `currentVersion` (the server's current
  data version).

### Stable error codes

This table is the authoritative list of machine `code` values. It is maintained
as part of the API contract; new codes are added here when introduced.

| `code` | HTTP status | Where | Meaning |
|---|---|---|---|
| `version_conflict` | 409 | Update Project (PUT) | The project was modified by another session; `currentVersion` holds the server's current data version. |
| `schema_not_ready` | 503 | Any route (readiness gate) | Database migrations are not fully applied; the API is not yet serving. |
| `config_not_ready` | 503 | Any route (readiness gate) | Required auth configuration (`jwt_secret` / `otp_hash_secret`) is missing or invalid. |

**Accepted variants (outside the standard envelope).** Two responses
intentionally diverge from the `{ error, code?, ... }` shape and are documented
here rather than normalized:

- **CORS preflight rejection** — a disallowed `Origin` yields an empty-body
  `403` with no JSON envelope.
- **Health endpoints** — `/api/health` and `/api/health/email` return a status
  document keyed on `status` (e.g. `{ "status": "ok", ... }` or
  `{ "status": "error", "error": "..." }`), not the standard error envelope.

> **Contract note.** The documented routes are the only public API contract (see
> [Public HTTP Surface](#public-http-surface)). The sole in-tree consumer is this
> repository's React frontend, which keys conflict handling on `currentVersion`,
> so moving the `version_conflict` token from `error` into `code` is a clean,
> non-breaking change for that consumer.

## Validation Limits

| Constraint | Value |
|---|---|
| Max payload size | 512 KB |
| Max registers per project | 256 |
| Max register width | 128 bits |
| Max fields per register | 64 |
| Max enum entries per field | 256 |
| Max name length | 200 chars |
| Max metadata string length | 500 chars |
| Valid `addressUnitBits` | 8, 16, 32, 64, 128 |

## API Server Configuration

In production, set these values in server-only `config.production.php`. The API also supports the environment-variable names below as fallbacks for containerized/local environments.

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | Yes | MySQL database host (default: `127.0.0.1`) |
| `DB_PORT` | No | MySQL port (default: `3306`) |
| `DB_DATABASE` | Yes | MySQL database name (default: `register_viewer`) |
| `DB_USERNAME` | Yes | MySQL database user |
| `DB_PASSWORD` | Yes | MySQL database password |
| `APP_ENV` | No | Set to `production` to restrict CORS. Default: `production`. |
| `JWT_SECRET` | Yes* | HMAC-SHA256 secret for signing JWT tokens. **Must be ≥32 characters.** Generate with: `openssl rand -hex 32` |
| `OTP_HASH_SECRET` | Yes* | Separate HMAC-SHA256 secret for pending email OTP verifiers. **Must be ≥32 characters.** Generate with: `openssl rand -hex 32` |
| `RESEND_API_KEY` | Yes* | API key from [Resend](https://resend.com/) for sending OTP emails. Without it, login codes won't be delivered (errors logged server-side). |
| `RESEND_FROM_EMAIL` | No | Sender email address for OTP emails. Default: `noreply@registerviewer.com`. Must be a verified domain in Resend. |

\* Required for deployed cloud save/share and authentication endpoints. Only a local-only/static frontend deployment with no API can omit them.

CORS is not read from an `ALLOWED_ORIGINS` environment variable; set the PHP `allowed_origins` array in `config.production.php`.
