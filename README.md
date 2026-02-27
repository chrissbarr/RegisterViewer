# Register Viewer

An interactive web tool for embedded and hardware developers to decode and encode register values based on user-defined field mappings.

**[Try it live at registerviewer.com](https://www.registerviewer.com/)**

Enter a raw register value (hex, binary, or decimal) and instantly see how it breaks down into named fields — or edit individual fields and watch the raw value update in real-time.

## Quick Start

1. Visit **[registerviewer.com](https://www.registerviewer.com/)** — no install or account required
2. A sample 32-bit `STATUS_REG` is pre-loaded with the value `0xDEADBEEF`
3. Try clicking bits in the grid, changing the hex value, or editing field values in the table below

## How It Works

1. **Define registers** — give each register a name, bit width, and optional memory offset
2. **Add fields** — map bit ranges to named fields with types like flags, enums, integers, floats, or fixed-point
3. **Enter a value** — type a hex, decimal, or binary value and see every field decoded instantly
4. **Edit interactively** — click individual bits, toggle flags, pick enum values, or type field values directly

All edits are bidirectional: changing the raw value updates the fields, and changing a field updates the raw value.

## Features

- **Any register width** — 8, 16, 32, 64-bit, or any arbitrary width up to 128 bits
- **Multiple registers** — define a collection of registers and switch between them in the sidebar
- **Rich field types**:
  - **Flags** — single-bit on/off with custom labels
  - **Enums** — multi-bit fields with named values (e.g., `0 = OFF, 1 = STANDBY, 2 = ACTIVE`)
  - **Integers** — signed or unsigned, any width
  - **IEEE 754 floats** — half, single, and double precision
  - **Fixed-point** — Qm.n notation with configurable integer and fractional bits
- **Clickable bit grid** — toggle individual bits visually, color-coded by field
- **Register map view** — see all registers laid out by memory offset with configurable table widths
- **Drag-and-drop reordering** — rearrange registers in the sidebar, or sort by offset
- **GUI and JSON editor** — define fields via a visual form or edit raw JSON for power users
- **Cloud save and share** — save projects to the cloud and share via short URLs, no account required
- **Snapshot URLs** — share small projects as self-contained compressed URLs with no server dependency
- **Import/export** — save and load register definitions as JSON files
- **Multiple projects** — manage separate register sets as independent projects
- **Dark and light theme**
- **Keyboard accessible** — full keyboard navigation with screen reader support

## Cloud Save and Share

Save your project to the cloud to get a shareable link. No account is needed — ownership is tracked by an anonymous token stored in your browser.

- **Private** projects are only accessible from your browser
- **Unlisted** projects can be shared via link — anyone with the link can view and fork a copy

For small projects, you can also generate a **snapshot URL** that encodes the entire project in the link itself, with no server dependency.

## Import and Export

Export your register definitions as a JSON file to back up your work or share with colleagues. Import a JSON file to load register definitions into a new project.

## Documentation

- **[User Guide](docs/user-guide.md)** — detailed walkthrough of all features
- **[Developer Guide](docs/DEVELOPMENT.md)** — local setup, testing, and project structure
- **[API Reference](docs/API.md)** — REST API for the cloud save/share backend
- **[Deployment Guide](docs/DEPLOYMENT.md)** — production deployment and CI/CD

## License

MIT
