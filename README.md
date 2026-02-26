# Register Viewer

An interactive web tool for embedded and hardware developers to decode and encode register values based on user-defined field mappings.

**[Try it live](https://www.registerviewer.com/)**

Enter a raw register value (hex, binary, or decimal) and instantly see how it breaks down into named fields — or edit individual fields and watch the raw value update in real-time.

## Features

- **Configurable register widths** — 8, 16, 32, 64-bit, or any arbitrary width
- **Multiple registers** — define a collection of named registers and switch between them
- **Bidirectional editing** — change the raw value to see fields update, or edit fields to see the raw value change
- **Clickable bit grid** — toggle individual bits visually, color-coded by field
- **Rich field types**:
  - Single-bit flags (boolean)
  - Multi-bit enums with named values
  - Integers (signed/unsigned, any width)
  - IEEE 754 floats (half, single, double precision)
  - Fixed-point (Qm.n notation)
- **GUI + JSON editor** — define fields via a visual form or edit raw JSON for power users
- **Persistence** — auto-saves to localStorage; export/import as JSON files
- **Cloud save & share** — save projects to the cloud and share via short URLs; no account required
- **Snapshot URLs** — share small projects as self-contained compressed URLs with no server dependency
- **Dark/light theme** with toggle

## Tech Stack

- **React 19** + **TypeScript** (strict mode)
- **Vite** for builds and dev server
- **Tailwind CSS v4** for styling
- **@dnd-kit** for drag-and-drop register reordering
- **PHP + MySQL** for the cloud save/share backend (deployed on cPanel, see [DEPLOYMENT.md](docs/DEPLOYMENT.md))

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:5173 in your browser. On first launch, an example 32-bit STATUS_REG is pre-loaded with `0xDEADBEEF`.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server with HMR |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |
| `npm run lint` | Run ESLint |
| `npm test` | Run all unit tests |
| `npm run test:watch` | Run tests in watch mode (re-runs on file changes) |
| `npm run test:coverage` | Run tests with V8 coverage report |
| `npm run test:e2e` | Run Playwright end-to-end tests |

### API (cloud backend)

Requires Docker for local development. See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for full setup.

| Command | Description |
|---------|-------------|
| `cd api && docker compose up -d` | Start local API + MySQL |
| `cd api && docker compose run --rm test bash -c "composer install -q && vendor/bin/phpunit"` | Run API tests |
| `cd api && docker compose down` | Stop containers |

## Testing

Unit tests use [Vitest](https://vitest.dev/) and live alongside source files as `.test.ts` siblings.

```bash
npm test                # Run once
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

Test files live as `.test.ts`/`.test.tsx` siblings next to source files. Key test areas:

- **Utilities** — bitwise, float, fixed-point, decode/encode, validation, storage, format, snapshot-url, owner-token, api-client, project-storage, cloud-project-loader, cloud-operations
- **Context providers** — app-context (reducer), cloud-sync-context, project-storage-context, preferences-context
- **Components** — app-loader, share-dialog, my-projects-dialog
- **Hooks** — use-dirty-tracking, use-my-projects-actions, use-project-cloud-ops
- **E2E (Playwright)** — project CRUD, cloud save/share/fork/delete, multi-tab, migration

## Project Structure

```
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
    viewer/  editor/  register-list/  # (unchanged)
  context/
    app-context.tsx             # React Context + useReducer state management
    cloud-sync-context.tsx      # Cloud project state (save/share/dirty tracking)
  utils/
    api-client.ts               # Fetch wrapper for cloud API
    owner-token.ts              # Anonymous owner token generation + hashing
    cloud-operations.ts         # Cloud save/delete/visibility operations
    snapshot-url.ts             # Compressed snapshot URL encode/decode
    bitwise.ts  decode.ts  encode.ts  float.ts  fixed-point.ts
    validation.ts  storage.ts  seed-data.ts  ...
  types/
    register.ts                 # Core TypeScript interfaces

api/                            # PHP API backend (cPanel)
  index.php                     # Entry point: routing, CORS, response helpers
  config.php                    # Configuration with getenv() fallbacks
  src/
    database.php                # PDO singleton factory
    data-access.php             # All DB queries
    validation.php              # Payload structural validation
    auth.php                    # Token extraction + ownership check
    cors.php                    # CORS header computation
    id.php                      # 12-char base62 ID generation
    handlers/*.php              # One file per endpoint
  tests/                        # PHPUnit tests (Unit + Integration)
  docker-compose.yml            # Local dev: API + MySQL + test runner
```
