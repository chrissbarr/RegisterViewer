# Register Viewer API Reference

Base URL: `https://<your-domain>/api`

## Authentication

All mutating endpoints require a Bearer token in the `Authorization` header:

```
Authorization: Bearer <token_hash>
```

The token hash is a 64-character lowercase hex string representing the SHA-256 hash of the client's owner token. The server never sees or stores the raw token.

**Constant-time comparison** is used for ownership checks to prevent timing side-channel attacks.

---

## Endpoints

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
  "shareUrl": "https://register-viewer.app/#/p/AbCdEfGhIjKl",
  "createdAt": "2026-02-23T09:00:00.000Z"
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
  "updatedAt": "2026-02-23T09:00:00.000Z"
}
```

**Cache-Control:**
- Private projects: `private, no-store`
- Unlisted projects: `public, max-age=60`

**Side effect:** Updates `lastAccessedAt` if stale >24 hours (async, non-blocking).

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

Replaces all project data. Visibility is optional (keeps existing if omitted).

**Auth:** Required (must be owner)

**Request Body:** Same schema as Create.

**Size limit:** 512 KB

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
| 400 | Invalid JSON, validation error, invalid visibility, payload too large |
| 401 | Missing or invalid Authorization header |
| 404 | Project not found or not owner |

---

### Patch Visibility

```
PATCH /api/projects/{id}
```

Updates only the project visibility without touching data.

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
      "visibility": "private",
      "createdAt": "2026-02-23T09:00:00.000Z",
      "updatedAt": "2026-02-23T09:00:00.000Z"
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
- `https://register-viewer.app`
- `https://chrissbarr.github.io`

**Development:** Any `localhost` or `127.0.0.1` origin is allowed when `ENVIRONMENT !== 'production'`.

**Override:** Set the `ALLOWED_ORIGINS` environment variable to a comma-separated list.

**Preflight:** All `OPTIONS` requests return `204` with CORS headers.

## Security Headers

All JSON responses include:

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
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
