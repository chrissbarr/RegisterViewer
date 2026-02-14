# Register Viewer/Decoder — Design & Architecture

## Context

Embedded and hardware developers frequently need to decode register values — interpreting which bits map to which flags, enums, integers, or floats. Existing online tools (Bitmask Wizard, Bittool, BitwiseCmd) handle basic bit manipulation but lack configurable field mappings with rich type support. This app fills that gap: define a register's field layout once, then interactively decode/encode values with full bidirectional editing.

**Key differentiator**: Bidirectional interaction — enter a raw value to see the breakdown, OR edit individual fields/bits and watch the raw value update in real-time. All views stay in sync.

## Status

All core features are implemented and working (Phases 1-7 complete):

- [x] Project scaffold (Vite + React + TypeScript + Tailwind CSS v4)
- [x] Core data model and state management (React Context + useReducer)
- [x] Bit manipulation utilities (bitwise, decode, encode, float, fixed-point)
- [x] Register viewer with bidirectional editing
- [x] Register definition editor (GUI form + JSON editor)
- [x] Persistence (localStorage auto-save + JSON file export/import)
- [x] Dark/light theme toggle
- [x] Example seed register on first launch

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Build tool | Vite | Modern standard, fast HMR, excellent TS support |
| Framework | React 18+ | Component model fits this UI perfectly |
| Language | TypeScript (strict) | Type safety critical for bit manipulation logic |
| Styling | Tailwind CSS v4 | Rapid development, built-in dark mode via `@custom-variant` |
| State | React Context + useReducer | Simple, no external deps, fits app complexity |
| Persistence | localStorage + file export/import | No backend needed |
| JSON editor | Textarea with validation | Minimal deps; could upgrade to CodeMirror later |

**Runtime dependencies**: Only React — zero additional runtime packages.

---

## Architecture

### Data Flow

Single source of truth: `registerValues[activeRegisterId]: bigint`

```
User types hex value ──→ parse to bigint ──→ state updates ──→ all views re-render
User toggles a bit ────→ XOR the bigint ──→ state updates ──→ all views re-render
User edits a field ────→ mask+shift+OR ───→ state updates ──→ all views re-render
```

**Why `bigint`?** Register widths can exceed 32 bits. JavaScript `number` loses precision above 2^53. `bigint` handles arbitrary widths correctly for all bitwise operations. Values are serialized as hex strings (`"0xDEADBEEF"`) for localStorage/JSON since `bigint` is not JSON-serializable.

### State Management

Actions dispatched via `useReducer`:
- `SET_REGISTER_VALUE` — set full register value (from hex/bin/dec input)
- `TOGGLE_BIT` — flip a single bit (from bit grid click)
- `SET_FIELD_VALUE` — update a field's bits (from field table edit)
- `ADD_REGISTER` / `UPDATE_REGISTER` / `DELETE_REGISTER` — manage register definitions
- `SET_ACTIVE_REGISTER` — switch active register
- `TOGGLE_THEME` — dark/light mode
- `IMPORT_REGISTERS` — load from JSON file
- `LOAD_STATE` — restore from localStorage

### Decoding / Encoding

All logic is in pure functions under `src/utils/`:

- **bitwise.ts**: `extractBits`, `replaceBits`, `toggleBit`, `getBit`, `toSigned`, `toUnsigned`, `clampToWidth`
- **decode.ts**: `decodeField` dispatches by field type to produce a `DecodedValue`
- **encode.ts**: `encodeField` converts user input back to raw bits per field type
- **float.ts**: IEEE 754 conversion using `DataView`/`ArrayBuffer` for single/double; manual implementation for half-precision
- **fixed-point.ts**: Qm.n decode/encode via `value / 2^n` and `round(input * 2^n)`

---

## JSON Config Schema

```json
{
  "version": 1,
  "registers": [
    {
      "id": "uuid",
      "name": "STATUS_REG",
      "description": "Example register",
      "width": 32,
      "fields": [
        { "id": "uuid", "name": "ENABLE", "msb": 0, "lsb": 0, "type": "flag" },
        { "id": "uuid", "name": "MODE", "msb": 3, "lsb": 1, "type": "enum",
          "enumEntries": [{ "value": 0, "name": "OFF" }, { "value": 1, "name": "RUN" }] },
        { "id": "uuid", "name": "GAIN", "msb": 15, "lsb": 8, "type": "integer", "signed": true },
        { "id": "uuid", "name": "COEFF", "msb": 31, "lsb": 16, "type": "fixed-point",
          "qFormat": { "m": 8, "n": 8 } }
      ]
    }
  ],
  "registerValues": { "uuid": "0xDEADBEEF" }
}
```

---

## Potential Future Enhancements

- Keyboard navigation between fields and bits
- Tooltips on bit hover showing field info
- Confirmation dialogs for destructive actions (delete register)
- Import SVD (CMSIS System View Description) files
- Shareable URLs with register definitions encoded
- CodeMirror upgrade for the JSON editor
- Unit tests for decode/encode utilities
- Responsive/mobile layout improvements

---

## Verification Checklist

1. `npm run build` succeeds with no errors
2. Create a 32-bit register with each field type, enter `0xDEADBEEF`, verify decoded values
3. Edit a field value in the table — hex/bin/dec inputs and bit grid update
4. Toggle a bit in the grid — field values update
5. Refresh the page — state is restored from localStorage
6. Export JSON, delete all registers, import the JSON — everything restores
7. Test 64-bit register (bigint correctness)
8. Test signed negative integers, IEEE 754 special values (NaN, Inf, -0)
