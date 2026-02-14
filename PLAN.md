# Register Viewer/Decoder Web App — Implementation Plan

## Context

Embedded and hardware developers frequently need to decode register values — interpreting which bits map to which flags, enums, integers, or floats. Existing online tools (Bitmask Wizard, Bittool, BitwiseCmd) handle basic bit manipulation but lack configurable field mappings with rich type support. This app fills that gap: define a register's field layout once, then interactively decode/encode values with full bidirectional editing.

**Key differentiator**: Bidirectional interaction — enter a raw value to see the breakdown, OR edit individual fields/bits and watch the raw value update in real-time. All views stay in sync.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Build tool | **Vite** | Modern standard, fast HMR, excellent TS support |
| Framework | **React 18+** | Component model fits this UI perfectly |
| Language | **TypeScript** (strict) | Type safety critical for bit manipulation logic |
| Styling | **Tailwind CSS 3** | Rapid development, built-in dark mode, utility-first |
| State | **React Context + useReducer** | Simple, no external deps, fits app complexity |
| Persistence | **localStorage** + file export/import | No backend needed |
| Code editor | **Textarea with JSON validation** (v1) | Keep deps minimal; upgrade to CodeMirror later if needed |

**npm packages** (minimal):
- `react`, `react-dom`
- `tailwindcss`, `postcss`, `autoprefixer`
- `@tailwindcss/forms` (optional, for nice form styling)
- No routing library (SPA with panels, not pages)

---

## Data Model

```typescript
// src/types/register.ts

type FieldType = 'flag' | 'enum' | 'integer' | 'float' | 'fixed-point';

interface EnumEntry {
  value: number;
  name: string;
}

interface Field {
  id: string;               // unique id (crypto.randomUUID())
  name: string;             // e.g. "MODE", "ENABLE", "GAIN"
  description?: string;
  msb: number;              // most significant bit (inclusive)
  lsb: number;              // least significant bit (inclusive)
  type: FieldType;
  // Type-specific config:
  signed?: boolean;         // for 'integer' type
  enumEntries?: EnumEntry[];// for 'enum' type
  floatType?: 'half' | 'single' | 'double'; // for 'float' type
  qFormat?: { m: number; n: number }; // for 'fixed-point' (Qm.n)
}

interface RegisterDef {
  id: string;
  name: string;             // e.g. "STATUS_REG"
  description?: string;
  width: number;            // total bits (8, 16, 32, 64, or any)
  fields: Field[];
}

interface RegisterState {
  defId: string;            // which RegisterDef this value is for
  value: bigint;            // current register value (bigint for >32-bit support)
}

interface AppState {
  registers: RegisterDef[];
  activeRegisterId: string | null;
  registerValues: Record<string, bigint>; // defId -> current value
  theme: 'light' | 'dark';
}
```

**Why `bigint`?** Register widths can exceed 32 bits. JavaScript `number` loses precision above 2^53. `bigint` handles arbitrary widths correctly for all bitwise operations.

---

## JSON Config Schema (export/import format)

```json
{
  "version": 1,
  "registers": [
    {
      "id": "...",
      "name": "STATUS_REG",
      "description": "Main status register",
      "width": 32,
      "fields": [
        {
          "id": "...",
          "name": "ENABLE",
          "msb": 0,
          "lsb": 0,
          "type": "flag"
        },
        {
          "id": "...",
          "name": "MODE",
          "msb": 3,
          "lsb": 1,
          "type": "enum",
          "enumEntries": [
            { "value": 0, "name": "OFF" },
            { "value": 1, "name": "LOW" },
            { "value": 2, "name": "HIGH" },
            { "value": 3, "name": "TURBO" }
          ]
        },
        {
          "id": "...",
          "name": "GAIN",
          "msb": 15,
          "lsb": 8,
          "type": "integer",
          "signed": true
        },
        {
          "id": "...",
          "name": "COEFF",
          "msb": 31,
          "lsb": 16,
          "type": "fixed-point",
          "qFormat": { "m": 8, "n": 8 }
        }
      ]
    }
  ]
}
```

---

## Component Hierarchy

```
<App>
  <ThemeProvider>
    <AppShell>                          // top-level layout: header + sidebar + main
      <Header>                          // app title, theme toggle, import/export buttons
      <Sidebar>                         // register list panel
        <RegisterList>                  // list of register defs, add/delete/select
          <RegisterListItem>            // single register entry (name, width badge)
      <MainPanel>                       // everything for the active register
        <RegisterHeader>               // register name, width, description, edit button
        <ValueInputBar>                // hex/bin/dec inputs for the raw register value
        <BitGrid>                      // visual bit grid (clickable, color-coded by field)
          <BitCell>                    // single bit: shows bit number, value, field color
        <FieldTable>                   // decoded field values table (bidirectional editing)
          <FieldRow>                   // single field: name, bits, raw binary, decoded value, edit control
        <RegisterEditor>              // define/edit fields (shown in a drawer/modal or tab)
          <FieldDefinitionForm>       // GUI form to add/edit a single field
          <JsonConfigEditor>          // textarea-based JSON editor (alternate view)
    </AppShell>
  </ThemeProvider>
```

---

## UI Layout (Main Screen)

```
+---------------------------------------------------------------+
| [Register Viewer]              [Import] [Export] [Theme: D/L] |
+------------+--------------------------------------------------+
|            |  STATUS_REG (32-bit)                    [Edit]   |
| Registers  |                                                   |
| ---------- |  Value: [0xDEADBEEF] [0b...] [3735928559]       |
| > STATUS   |                                                   |
|   CONTROL  |  +--+--+--+--+--+--+--+--+--+--+-- ... --+--+   |
|   CONFIG   |  |31|30|29|28|27|26|25|24|23|22|21  ...  | 0|   |
|            |  | 1| 1| 0| 1| 1| 1| 1| 0| 1| 0| 1  ...  | 1|   |
| [+ Add]    |  +--+--+--+--+--+--+--+--+--+--+-- ... --+--+   |
|            |  [colored by field]                               |
|            |                                                   |
|            |  Field Breakdown:                                 |
|            |  +--------+------+--------+-----------+--------+ |
|            |  | Name   | Bits | Binary | Decoded   | Edit   | |
|            |  +--------+------+--------+-----------+--------+ |
|            |  | ENABLE | [0]  | 1      | true      | [tog]  | |
|            |  | MODE   | [3:1]| 111    | TURBO (7) | [drop] | |
|            |  | GAIN   | [15:8]| ...   | -82       | [input]| |
|            |  | COEFF  |[31:16]| ...   | 3.14      | [input]| |
|            |  +--------+------+--------+-----------+--------+ |
+------------+--------------------------------------------------+
```

---

## Bidirectional Data Flow

**Single source of truth**: `registerValues[activeRegisterId]: bigint`

All views read from and write to this single value:

```
User types hex value ──→ parse to bigint ──→ state updates ──→ all views re-render
User toggles a bit ────→ XOR the bigint ──→ state updates ──→ all views re-render
User edits a field ────→ mask+shift+OR ───→ state updates ──→ all views re-render
```

**Decoding** (value → display): Extract bits using mask & shift, interpret per field type.
**Encoding** (field edit → value): Clear the field's bits, then OR in the new value.

---

## Decoding / Encoding Logic

All logic lives in pure functions in `src/utils/`:

### `src/utils/bitwise.ts` — core bit manipulation
- `extractBits(value: bigint, msb: number, lsb: number): bigint` — extract a field's raw bits
- `replaceBits(value: bigint, msb: number, lsb: number, fieldValue: bigint): bigint` — replace a field's bits
- `toggleBit(value: bigint, bit: number): bigint` — flip a single bit
- `getBit(value: bigint, bit: number): 0 | 1` — read a single bit

### `src/utils/decode.ts` — interpret raw bits by field type
- `decodeField(rawBits: bigint, field: Field): DecodedValue` — dispatch by type:
  - **flag**: `rawBits === 1n`
  - **enum**: lookup in `enumEntries`, fallback to raw number + "UNKNOWN"
  - **integer**: unsigned = raw value; signed = two's complement conversion
  - **float**: reconstruct IEEE 754 from bits (half/single/double)
  - **fixed-point**: split into integer and fractional parts per Qm.n, compute `integer + fraction / 2^n`

### `src/utils/encode.ts` — convert user input back to raw bits
- `encodeField(input: string | number | boolean, field: Field): bigint`

### IEEE 754 float handling
- Use `DataView` with `ArrayBuffer` for single/double: write bits as `Uint32`/`BigUint64`, read back as `Float32`/`Float64`
- Half-precision (16-bit): manual implementation (sign + 5-bit exponent + 10-bit mantissa)

### Fixed-point (Qm.n)
- Decode: `value_as_signed_int / 2^n`
- Encode: `Math.round(float_input * 2^n)`, then store as signed integer

---

## State Management

```typescript
// src/context/app-context.tsx

type Action =
  | { type: 'SET_REGISTER_VALUE'; registerId: string; value: bigint }
  | { type: 'TOGGLE_BIT'; registerId: string; bit: number }
  | { type: 'SET_FIELD_VALUE'; registerId: string; fieldId: string; rawBits: bigint }
  | { type: 'ADD_REGISTER'; register: RegisterDef }
  | { type: 'UPDATE_REGISTER'; register: RegisterDef }
  | { type: 'DELETE_REGISTER'; registerId: string }
  | { type: 'SET_ACTIVE_REGISTER'; registerId: string }
  | { type: 'TOGGLE_THEME' }
  | { type: 'IMPORT_STATE'; registers: RegisterDef[] }
  | { type: 'LOAD_SAVED_STATE'; state: AppState };
```

Reducer handles all mutations. A `useEffect` hook syncs state to `localStorage` on every change (debounced).

---

## Project Structure

```
src/
  main.tsx                    # entry point
  app.tsx                     # root component, wraps with providers
  index.css                   # Tailwind directives + global styles
  types/
    register.ts               # all TypeScript interfaces
  context/
    app-context.tsx            # AppState, reducer, provider, hook
  utils/
    bitwise.ts                # extractBits, replaceBits, toggleBit, getBit
    decode.ts                 # decodeField (all field types)
    encode.ts                 # encodeField (all field types)
    float.ts                  # IEEE 754 half/single/double helpers
    fixed-point.ts            # Qm.n encode/decode
    validation.ts             # validate register defs, detect overlaps
    storage.ts                # localStorage save/load, JSON export/import
  components/
    layout/
      app-shell.tsx           # top-level grid layout
      header.tsx              # title, theme toggle, import/export
      sidebar.tsx             # register list panel wrapper
    register-list/
      register-list.tsx       # list + add button
      register-list-item.tsx  # single item
    viewer/
      value-input-bar.tsx     # hex/bin/dec input fields
      bit-grid.tsx            # visual bit grid
      bit-cell.tsx            # single clickable bit
      field-table.tsx         # decoded fields table
      field-row.tsx           # single field row with edit controls
    editor/
      register-editor.tsx     # add/edit register + fields
      field-definition-form.tsx # form for one field
      json-config-editor.tsx  # JSON textarea editor
    common/
      theme-toggle.tsx        # dark/light switch
```

---

## Styling Approach

**Tailwind CSS** with `darkMode: 'class'` strategy:
- Toggle adds/removes `dark` class on `<html>`
- All components use `dark:` variants for colors
- Field colors: assign a color from a palette to each field for the bit grid (cycle through ~8-10 distinct colors)
- Bit grid: CSS Grid or flexbox, each cell ~24-30px, responsive wrapping for large registers

**Color palette for fields** (works in both themes):
```
blue, green, amber, rose, purple, cyan, orange, teal, pink, indigo
```

---

## Implementation Phases

### Phase 1: Project Scaffold + Core Data Model
- `npm create vite@latest . -- --template react-ts`
- Install Tailwind CSS, configure dark mode
- Define all TypeScript interfaces in `types/register.ts`
- Set up `app-context.tsx` with reducer and provider
- Build `app-shell.tsx` layout skeleton with header + sidebar + main panel
- Implement theme toggle (dark/light)

### Phase 2: Bit Manipulation Utilities
- Implement `bitwise.ts` (extractBits, replaceBits, toggleBit, getBit)
- Implement `decode.ts` and `encode.ts` for all field types
- Implement `float.ts` (IEEE 754 half/single/double)
- Implement `fixed-point.ts` (Qm.n)
- (Could add unit tests here if desired)

### Phase 3: Register Viewer (Read Direction)
- `ValueInputBar` — hex/bin/dec inputs, parse to bigint, update state
- `BitGrid` + `BitCell` — render all bits, color-code by field, click to toggle
- `FieldTable` + `FieldRow` — show decoded value for each field

### Phase 4: Bidirectional Editing (Write Direction)
- Field-type-specific edit controls in `FieldRow`:
  - **flag**: checkbox/toggle
  - **enum**: dropdown select
  - **integer/float/fixed-point**: number input
- Editing a field → `encodeField()` → `replaceBits()` → state update → all views refresh

### Phase 5: Register Definition Editor
- `RegisterEditor` — create/edit register (name, width, description)
- `FieldDefinitionForm` — add/edit fields with type-specific options
- `JsonConfigEditor` — textarea to view/edit full JSON config
- Validation: detect overlapping bit ranges, invalid configs

### Phase 6: Persistence + Import/Export
- `storage.ts` — save/load from localStorage on state changes
- Export button → download JSON file
- Import button → file picker, parse JSON, validate, load into state

### Phase 7: Polish
- Responsive layout tweaks
- Keyboard shortcuts (tab between fields, etc.)
- Tooltip showing field info on bit hover
- Empty states, error messages, confirmation dialogs for delete
- Seed with a example register on first load (so app isn't empty)

---

## Verification / Testing

1. **Manual smoke test**: Run `npm run dev`, create a 32-bit register with one of each field type (flag, enum, integer, float, fixed-point), enter `0xDEADBEEF`, verify decoded values are correct
2. **Bidirectional test**: Edit a field value in the table, verify the hex/bin/dec inputs and bit grid update. Toggle a bit in the grid, verify field values update
3. **Persistence test**: Refresh the page, verify all register defs and values are restored from localStorage
4. **Import/export test**: Export JSON, delete all registers, import the JSON, verify everything is restored
5. **Edge cases**:
   - 64-bit register (verify bigint works)
   - All bits assigned to fields (no gaps)
   - Overlapping field detection in editor
   - Signed negative integers decode correctly
   - IEEE 754 special values (NaN, Inf, -0)
   - Qm.n fixed-point round-trip accuracy
6. **Build test**: `npm run build` succeeds with no errors
