# Register Viewer API Reference

Base URL: `https://<your-domain>/api`

## Public HTTP Surface

Only documented routes under `/api/health`, `/api/health/email`, `/api/auth/*`, and `/api/projects*` are public API contract. PHP source files, Composer/vendor files, migrations, database files, config files, tests, and deployment internals under paths such as `/api/src`, `/api/vendor`, `/api/database`, and `/api/tests` are implementation details. Production deployments must deny those paths with `403`.

## Health Endpoints

### API Health

```
GET /api/health
HEAD /api/health
```

Checks database connectivity, verifies every numbered migration in `api/database/migrations/` has been applied, and verifies the schema required by the current API code exists. The readiness check includes `projects.version`, which is required for optimistic concurrency on project updates.

**Response `200 OK`:**

```json
{
  "status": "ok",
  "database": "ok",
  "migrations": "ready",
  "schema": {
    "projects.version": true
  },
  "appliedMigrations": [1, 2],
  "pendingMigrations": [],
  "timestamp": "2026-05-10T00:00:00Z"
}
```

**Response `503 Service Unavailable`:**

Returned when the database is unavailable, another request holds the migration lock, a migration fails, a numbered migration is not recorded as applied, or required schema shape cannot be established.

```json
{
  "error": "Service temporarily unavailable",
  "code": "schema_not_ready"
}
```

Normal API routes use the same pre-routing readiness gate and may return this `503` before route-specific validation or authentication.

### Email Health

```
GET /api/health/email
HEAD /api/health/email
```

Checks that the Resend API key is configured and the provider API is reachable. This endpoint is also behind the API schema readiness gate.

## Authentication

The API supports two authentication methods. The server auto-detects which is in use by inspecting the token format.

### JWT Authentication (Recommended)

Obtained by completing the email OTP flow via `POST /api/auth/verify-code`.

```
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

- **Algorithm:** HMAC-SHA256
- **Expiry:** 24 hours from issue
- **Claims:** `sub` (user ID), `email`, `iat`, `exp`, `jti` (token ID for revocation)
- **Scope:** Grants access to all projects owned by the authenticated user

### Legacy Token Hash Authentication

Generated client-side via `hashOwnerToken()`. A 64-character lowercase hex string (SHA-256 hash of the raw owner token). For legacy token-hash auth, only the hash is sent in the `Authorization` header. For JWT-authenticated create and verify-code requests, the raw token is sent in the body and the server hashes it server-side to verify possession.

```
Authorization: Bearer abc123def456...  (64-char hex)
```

- **Expiry:** None — valid indefinitely
- **Scope:** Grants access to projects created with the same token hash
- **Note:** Being phased out in favor of JWT for multi-device and recovery scenarios

### Ownership Model

- **Token hash projects:** Owned by the token hash. Any request with the matching hash can modify/delete.
- **JWT user projects:** Owned by the user ID. Any valid JWT for that user can modify/delete all their projects.
- **Migration:** Pass `ownerToken` (raw 64-char hex token) when calling `POST /api/auth/verify-code` to link existing anonymous projects to a user account. The server hashes it server-side to verify possession. The token hash continues to work for backward compatibility.

**Constant-time comparison** (`hash_equals`) is used for all ownership checks to prevent timing side-channel attacks.

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

---

### Verify Login Code

```
POST /api/auth/verify-code
```

Verifies a 6-digit OTP code and returns a JWT token. Optionally links anonymous projects to the new user account.

**Auth:** Not required

**Request Body:**

```json
{
  "email": "user@example.com",
  "code": "123456",
  "ownerToken": "abc123..."
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `email` | Yes | Email address the code was sent to |
| `code` | Yes | 6-digit OTP code |
| `ownerToken` | No | 64-char hex raw owner token — server hashes it to link anonymous projects to this user |

**Rate Limiting:**
- Max 10 verification attempts per email per 10-minute window
- Max 5 attempts per individual code

**Code Expiry:** 10 minutes after generation. Single-use (marked used on success).

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

Creates a new project and returns a share URL.

**Auth:** Required

**Request Body:**

```jsonc
{
  "data": {
    "version": 1,                              // Required, must be 1
    "registers": [                             // Required, 1–256 registers
      {
        "name": "CTRL",                        // Required, 1–200 chars
        "width": 8,                            // Required, 1–1024 bits
        "fields": [                            // Required, 0–64 fields
          {
            "name": "EN",                      // Required, 1–200 chars
            "type": "flag",                    // "flag"|"enum"|"integer"|"float"|"fixed-point"
            "msb": 0,                          // Required, non-negative integer
            "lsb": 0                           // Required, non-negative integer
          }
        ],
        "description": "Control register",     // Optional
        "offset": 0,                           // Optional, non-negative integer
        "id": "reg-1"                          // Optional
      }
    ],
    "registerValues": { "reg-1": "0xFF" },     // Required, hex string values
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

**Response `201 Created`:**

```json
{
  "id": "AbCdEfGhIjKl",
  "shareUrl": "https://www.registerviewer.com/#/p/AbCdEfGhIjKl",
  "createdAt": "2026-02-23T09:00:00.000Z",
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

**Auth:** Required for `private` projects. Not required for `unlisted` projects.

**Response `200 OK`:**

```json
{
  "id": "AbCdEfGhIjKl",
  "data": { "version": 1, "registers": [...], "registerValues": {...} },
  "createdAt": "2026-02-23T09:00:00.000Z",
  "updatedAt": "2026-02-23T09:00:00.000Z",
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
| 404 | Project not found, or private project without valid auth |

Private projects return 404 (not 401/403) to prevent information leakage.

---

### Update Project

```
PUT /api/projects/{id}
```

Replaces all project data and preserves the current visibility. Uses optimistic concurrency via a `version` field. Visibility changes must use `PATCH /api/projects/{id}`.

**Auth:** Required (must be owner)

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
  "updatedAt": "2026-02-23T10:00:00.000Z",
  "version": 4
}
```

**Response `409 Conflict`** (version mismatch):

```json
{
  "error": "version_conflict",
  "message": "Project has been modified by another session",
  "currentVersion": 5
}
```

The client should fetch the latest version and either merge or let the user choose.

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

**Auth:** Required (must be owner)

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
  "updatedAt": "2026-02-23T10:00:00.000Z"
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

Permanently deletes a project and its owner index entry.

**Auth:** Required (must be owner)

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

**Auth:** Required

**Response `200 OK`:**

```json
{
  "projects": [
    {
      "id": "AbCdEfGhIjKl",
      "title": "My Project",
      "visibility": "private",
      "createdAt": "2026-02-23T09:00:00.000Z",
      "updatedAt": "2026-02-23T09:00:00.000Z",
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

**Production origins:**
- `https://www.registerviewer.com`

**Development:** Any `localhost` or `127.0.0.1` origin is allowed when `ENVIRONMENT !== 'production'`.

**Override:** Set the `ALLOWED_ORIGINS` environment variable to a comma-separated list.

**Preflight:** All `OPTIONS` requests return `204` with CORS headers.

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

```json
{
  "error": "Human-readable error message"
}
```

## Validation Limits

| Constraint | Value |
|---|---|
| Max payload size | 512 KB |
| Max registers per project | 256 |
| Max register width | 1,024 bits |
| Max fields per register | 64 |
| Max enum entries per field | 256 |
| Max name length | 200 chars |
| Max metadata string length | 500 chars |
| Valid `addressUnitBits` | 8, 16, 32, 64, 128 |

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DB_HOST` | Yes | MySQL database host (default: `127.0.0.1`) |
| `DB_PORT` | No | MySQL port (default: `3306`) |
| `DB_DATABASE` | Yes | MySQL database name (default: `register_viewer`) |
| `DB_USERNAME` | Yes | MySQL database user |
| `DB_PASSWORD` | Yes | MySQL database password |
| `APP_ENV` | No | Set to `production` to restrict CORS. Default: `production`. |
| `ALLOWED_ORIGINS` | No | Configured in `config.php` `allowed_origins` array |
| `JWT_SECRET` | Yes* | HMAC-SHA256 secret for signing JWT tokens. **Must be ≥32 characters.** Generate with: `openssl rand -hex 32` |
| `RESEND_API_KEY` | Yes* | API key from [Resend](https://resend.com/) for sending OTP emails. Without it, login codes won't be delivered (errors logged server-side). |
| `RESEND_FROM_EMAIL` | No | Sender email address for OTP emails. Default: `noreply@registerviewer.com`. Must be a verified domain in Resend. |

\* Required for email authentication. Optional if deploying without the auth feature.
