# Developer Guide

This document covers local development setup, build commands, testing, and project structure for contributors to Register Viewer.

## Tech Stack

- **React 19** + **TypeScript** (strict mode)
- **Vite** for builds and dev server
- **Tailwind CSS v4** for styling
- **@dnd-kit** for drag-and-drop register reordering
- **Vitest** for unit tests, **Playwright** for E2E tests
- **PHP 8.3 + MySQL 8.0** for the cloud save/share backend (deployed on cPanel)

## Getting Started

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 in your browser. On first launch, an example 32-bit STATUS_REG is pre-loaded with `0xDEADBEEF`.

## Scripts

All frontend commands run from the `frontend/` directory:

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with HMR |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |
| `npm run knip` | Dead code detection (unused exports, files, types, dependencies) |
| `npm test` | Run all unit tests |
| `npm run test:watch` | Run tests in watch mode (re-runs on file changes) |
| `npm run test:coverage` | Run tests with V8 coverage report |
| `npm run test:e2e` | Run Playwright end-to-end tests |

### API Backend (requires Docker)

| Command | Description |
|---------|-------------|
| `cd api && docker compose up -d` | Start local API + MySQL (port 8080) |
| `cd api && docker compose run --rm test bash -c "composer install -q && php database/migrate.php && vendor/bin/phpunit"` | Run all API tests |
| `cd api && docker compose run --rm test bash -c "composer install -q && php database/migrate.php && vendor/bin/phpunit --testsuite Unit"` | Unit tests only |
| `cd api && docker compose run --rm test bash -c "composer install -q && php database/migrate.php && vendor/bin/phpunit --testsuite Integration"` | Integration tests only |
| `cd api && docker compose down` | Stop containers |
| `cd api && docker compose down -v` | Stop containers and reset database |

The PHP migration runner owns local schema creation. The API runs pending numbered migrations before routing, and test commands run `php database/migrate.php` before PHPUnit. API code and tests run PHP/MySQL sessions in UTC; UTC regression tests intentionally switch PHP and MySQL sessions to non-UTC values before asserting API timestamps are emitted as `YYYY-MM-DDTHH:mm:ssZ`.

To reset and re-run migrations: `cd api && docker compose down -v && docker compose up -d`, then request the API or run `php database/migrate.php` in the test container.

### Local Frontend + API

To test cloud features locally:

1. Start the API: `cd api && docker compose up -d`
2. The `frontend/.env.development` file already sets `VITE_API_URL=http://localhost:8080`
3. Start the frontend: `cd frontend && npm run dev`

Production GitHub Actions validate `VITE_API_URL` as a canonical lowercase HTTPS origin on a public DNS host with no trailing slash or path. Local development intentionally uses the localhost HTTP origin above.

## Architecture

Register Viewer is a React SPA with a PHP API backend for cloud save/share. The frontend handles all register decoding/encoding client-side; the API provides REST endpoints for persistent cloud storage.

- **State management**: `useReducer` + split React Contexts (state/dispatch) to avoid unnecessary re-renders
- **Register values**: Stored as `bigint` at runtime to support registers wider than 53 bits. Serialized as hex strings (`"0xDEADBEEF"`) in localStorage and JSON exports.
- **Bit indexing**: Fields use `[msb, lsb]` inclusive, 0-indexed from LSB
- **Persistence**: Multi-project localStorage with per-project keys, debounced auto-save (300ms)

See [API Reference](API.md) for the REST API and [Deployment Guide](DEPLOYMENT.md) for production setup.

## Testing

Unit tests use [Vitest](https://vitest.dev/) and live alongside source files as `.test.ts` siblings.

```bash
cd frontend
npm test                # Run once
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
npm run test:e2e        # Playwright E2E tests
```

Key test areas:

- **Utilities** — bitwise, float, fixed-point, decode/encode, validation, storage, format, snapshot-url, api-client, project-storage, cloud-project-loader, cloud-operations
- **Context providers** — app-context (reducer), cloud-sync-context, project-storage-context, preferences-context, auth-context
- **Components** — app-loader, share-dialog, my-projects-dialog, login-dialog
- **Hooks** — use-dirty-tracking, use-my-projects-actions, use-project-cloud-ops
- **E2E (Playwright)** — project CRUD, cloud save/share/fork/delete, multi-tab, migration
- **API Tests (PHPUnit)** — validation, ID generation, CORS, auth (extractAuth, isProjectOwner), JWT creation/verification, OTP send/verify flow, rate limiting, email sending

### Dead Code Detection

Run `npm run knip` from the `frontend/` directory after adding or removing exports, renaming functions, or deleting files. Config lives in `frontend/knip.config.ts`.

## Project Structure

```
frontend/                           # React SPA
  src/
    components/
      app-loader.tsx              # Hash fragment routing (cloud links, snapshot URLs)
      layout/
        app-shell.tsx             # Top-level layout, theme sync, auto-save
        header.tsx                # Title bar, save/share/import/export, theme toggle
        sidebar.tsx               # Register list panel
      common/
        save-button.tsx           # Cloud save button with loading state
        share-button.tsx          # Share button (opens share dialog)
        share-dialog.tsx          # Share URL options (snapshot + cloud link)
        shared-project-banner.tsx # Banner when viewing a shared project
        ...
      projects/
        my-projects-dialog.tsx    # List of saved projects (local + cloud)
      viewer/  editor/  register-list/
    context/
      app-context.tsx             # React Context + useReducer state management
      auth-context.tsx            # Email OTP auth state, JWT storage
      cloud-sync-context.tsx      # Cloud project state (save/share/dirty tracking)
      preferences-context.tsx     # Theme + sidebar preferences
      edit-context.tsx            # Register draft management
      project-storage-context.tsx # Multi-project localStorage manifest
    utils/
      api-client.ts               # Fetch wrapper for cloud API
      cloud-operations.ts         # Cloud save/delete/visibility operations
      snapshot-url.ts             # Compressed snapshot URL encode/decode
      bitwise.ts  decode.ts  encode.ts  float.ts  fixed-point.ts
      validation.ts  storage.ts  seed-data.ts  ...
    types/
      register.ts                 # Core TypeScript interfaces
  test_e2e/                       # Playwright E2E tests
  scripts/                        # Screenshot generation helpers

api/                              # PHP API backend (cPanel)
  index.php                       # Entry point: routing, CORS, response helpers
  config.php                      # Configuration with getenv() fallbacks
  src/
    database.php                  # PDO singleton factory
    data-access.php               # All DB queries
    validation.php                # Payload structural validation
    request-body.php              # Request body size limits and JSON parsing
    router.php                    # Route resolution, body policy, and dispatch
    auth.php                      # JWT extraction and user_id ownership checks
    jwt.php                       # JWT creation/verification (firebase/php-jwt)
    email.php                     # OTP email sending via Resend API
    cors.php                      # CORS header computation
    id.php                        # 12-char base62 ID generation
    handlers/*.php                # One file per endpoint
  tests/                          # PHPUnit tests (Unit + Integration)
  docker-compose.yml              # Local dev: API + MySQL + test runner
```
