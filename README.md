# Register Viewer

An interactive web tool for embedded and hardware developers to decode and encode register values based on user-defined field mappings.

**[Try it live](https://chrissbarr.github.io/RegisterViewer/)**

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
- **Cloudflare Workers + KV** for the cloud save/share backend (optional, see [DEPLOYMENT.md](docs/DEPLOYMENT.md))

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

### Worker (cloud backend)

| Command | Description |
|---------|-------------|
| `cd worker && npm run dev` | Start local Worker dev server (localhost:8787) |
| `cd worker && npm test` | Run Worker unit tests |
| `cd worker && npm run deploy` | Deploy Worker to Cloudflare |

## Testing

Unit tests use [Vitest](https://vitest.dev/) and live alongside source files as `.test.ts` siblings.

```bash
npm test                # Run once
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

Test files:
- `src/utils/bitwise.test.ts` — bit extraction, replacement, signed/unsigned conversion
- `src/utils/float.test.ts` — IEEE 754 half/single/double encode/decode
- `src/utils/fixed-point.test.ts` — Qm.n fixed-point encode/decode
- `src/utils/decode.test.ts` — field decoding for all 5 field types
- `src/utils/encode.test.ts` — field encoding for all 5 field types
- `src/utils/validation.test.ts` — register/field validation, overlap detection
- `src/utils/storage.test.ts` — serialization, localStorage, JSON import/export
- `src/context/app-context.test.ts` — all reducer actions

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
      saved-projects-dialog.tsx # List of saved cloud projects
      shared-project-banner.tsx # Banner when viewing a shared project
      ...
    viewer/  editor/  register-list/  # (unchanged)
  context/
    app-context.tsx             # React Context + useReducer state management
    cloud-context.tsx           # Cloud project state (save/share/dirty tracking)
  utils/
    api-client.ts               # Fetch wrapper for cloud API
    owner-token.ts              # Anonymous owner token generation + hashing
    cloud-projects.ts           # Local project records in localStorage
    snapshot-url.ts             # Compressed snapshot URL encode/decode
    bitwise.ts  decode.ts  encode.ts  float.ts  fixed-point.ts
    validation.ts  storage.ts  seed-data.ts  ...
  types/
    register.ts                 # Core TypeScript interfaces

worker/                         # Cloudflare Worker backend (optional)
  src/
    index.ts                    # Entry point: CORS, routing, CRUD handlers
    types.ts                    # StoredProject, Env, API response types
    data-access.ts              # KV read/write with schema migration
    validation.ts               # Payload structural validation
    auth.ts                     # Token extraction + constant-time comparison
    id.ts                       # 12-char base62 ID generation
  wrangler.toml                 # Worker configuration
```
