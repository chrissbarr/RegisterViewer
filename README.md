# Register Viewer

An interactive web tool for embedded and hardware developers to decode and encode register values based on user-defined field mappings.

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
- **Persistence** — auto-saves to localStorage; export/import as JSON files for sharing
- **Dark/light theme** with toggle

## Tech Stack

- **React 18** + **TypeScript** (strict mode)
- **Vite** for builds and dev server
- **Tailwind CSS v4** for styling
- **No runtime dependencies** beyond React

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

## Project Structure

```
src/
  App.tsx                       # Root component, loads saved state or seeds example
  main.tsx                      # Entry point
  index.css                     # Tailwind directives + theme config
  types/
    register.ts                 # TypeScript interfaces (Field, RegisterDef, AppState, etc.)
  context/
    app-context.tsx             # React Context + useReducer state management
  utils/
    bitwise.ts                  # Bit extraction, replacement, toggling
    decode.ts                   # Decode field values from register (all types)
    encode.ts                   # Encode user input back to raw bits
    float.ts                    # IEEE 754 half/single/double conversion
    fixed-point.ts              # Qm.n fixed-point encode/decode
    validation.ts               # Register definition validation, overlap detection
    storage.ts                  # localStorage persistence, JSON export/import
    seed-data.ts                # Example register for first-launch experience
  components/
    layout/
      app-shell.tsx             # Top-level layout, theme sync, auto-save
      header.tsx                # Title bar, import/export buttons, theme toggle
      sidebar.tsx               # Register list panel
    register-list/
      register-list.tsx         # List of registers + add button
      register-list-item.tsx    # Single register entry
    viewer/
      main-panel.tsx            # Main content area (viewer or editor mode)
      value-input-bar.tsx       # Hex/binary/decimal value inputs
      bit-grid.tsx              # Visual bit grid with field coloring
      bit-cell.tsx              # Single clickable bit (unused, inlined in grid)
      field-table.tsx           # Decoded field values table
      field-row.tsx             # Single field with edit controls
    editor/
      register-editor.tsx       # Register definition editor (GUI + JSON tabs)
      field-definition-form.tsx # GUI form for defining a single field
      json-config-editor.tsx    # Raw JSON editor with validation
    common/
      theme-toggle.tsx          # Dark/light mode switch
```
