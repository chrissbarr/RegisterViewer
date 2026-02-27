# Register Viewer User Guide

A complete guide to using [Register Viewer](https://www.registerviewer.com/) — an interactive tool for decoding and encoding hardware register values.

## Table of Contents

- [Getting Started](#getting-started)
- [The Interface](#the-interface)
- [Creating and Editing Registers](#creating-and-editing-registers)
- [Field Types](#field-types)
- [Working with Values](#working-with-values)
- [The Bit Grid](#the-bit-grid)
- [The Field Table](#the-field-table)
- [Register Map View](#register-map-view)
- [Managing Registers](#managing-registers)
- [Projects](#projects)
- [Cloud Save and Share](#cloud-save-and-share)
- [Snapshot URLs](#snapshot-urls)
- [Import and Export](#import-and-export)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Tips and Troubleshooting](#tips-and-troubleshooting)

---

## Getting Started

Visit **[registerviewer.com](https://www.registerviewer.com/)** — no install or account required.

A sample 32-bit `STATUS_REG` register is pre-loaded with the value `0xDEADBEEF` so you can explore immediately. Try:

- Changing the hex value in the input bar
- Clicking bits in the colorful grid
- Editing field values in the table below the grid

Everything updates in real-time: change the raw value and fields update, change a field and the raw value updates.

---

## The Interface

The app has three main areas:

1. **Sidebar** (left) — lists your registers. Click one to view it. Drag to reorder. Collapse with the chevron or **Ctrl+B**.
2. **Value bar** (top of main panel) — hex, decimal, and binary inputs for the current register's raw value.
3. **Bit grid and field table** (main panel) — visual bit-level view and a table of decoded field values.

There's also a **Register Map** tab that shows all registers laid out by memory address (visible when registers have offsets set).

The header contains the **Share** button, **Save** button (for cloud projects), and an **application menu** (hamburger icon) with access to project settings, import/export, examples, and more.

---

## Creating and Editing Registers

### Adding a register

Click the **+ Add Register** button at the bottom of the sidebar. A new 32-bit register is created with a default name like `REG_0`.

### Editing a register

Click the **Edit** button (pencil icon) in the main panel header to enter edit mode. You can change:

- **Name** — the register identifier (e.g., `CTRL_REG`)
- **Width** — bit width from 1 to 128
- **Offset** — optional memory address (hex like `0x04` or decimal)
- **Description** — optional text describing the register's purpose

### Adding fields

In edit mode, click **Add Field** to define a new field. Each field maps a range of bits to a named, typed value.

For each field you specify:

- **Name** — field identifier (e.g., `ENABLE`, `MODE`)
- **Type** — one of: flag, enum, integer, float, fixed-point
- **Bit range** — MSB and LSB (inclusive, 0-indexed from the least significant bit)
- **Description** — optional

Some types have additional options (see [Field Types](#field-types) below).

Click **Done** when finished editing a field, then **Save** to commit all changes.

### JSON editing

Switch to the **JSON** tab in the editor to view and edit the raw field definitions as JSON. This is useful for power users or when pasting field definitions from documentation.

---

## Field Types

### Flag

A single-bit boolean field. Displays as a toggle button in the field table.

- Configure custom labels for the set and clear states (defaults: "set" / "clear")
- Any non-zero raw value is treated as "set"

### Enum

A multi-bit field with named values. Displays as a dropdown in the field table.

- Add value/name pairs (e.g., `0 = OFF`, `1 = STANDBY`, `2 = ACTIVE`)
- If the current raw value doesn't match any entry, it shows as "Unknown (value)"

### Integer

A multi-bit numeric field. Displays as a text input.

- Choose signedness: **unsigned**, **two's complement**, or **sign-magnitude**
- Supports any bit width

### Float (IEEE 754)

Interprets bits as an IEEE 754 floating-point number.

- Choose precision: **half (16-bit)**, **single (32-bit)**, or **double (64-bit)**
- The field's bit range must match the chosen precision width

### Fixed-Point

Interprets bits as a fixed-point number in Q notation.

- Configure the number of **integer bits** (m) and **fractional bits** (n)
- The total must match the field's bit width
- Displays the decoded decimal value with appropriate precision

---

## Working with Values

The value bar at the top of the main panel has three input fields:

### Hex input

The primary input. Type hexadecimal digits (0-9, A-F). The value is automatically zero-padded or truncated to match the register width.

The hex input uses **overwrite mode**: Backspace replaces the digit before the cursor with `0` and moves left, rather than deleting it. This keeps the value width consistent.

### Decimal input

Shows the register value as an unsigned decimal integer. Type any decimal number.

### Binary input

Shows the register value in binary with spaces every 4 bits for readability (e.g., `1101 1110 1010 1101`).

All three inputs stay synchronized — changing any one updates the others and the bit grid/field table.

Each input has a **copy button** to copy the current value to the clipboard.

---

## The Bit Grid

The bit grid is a visual representation of every bit in the register, color-coded by field.

### Layout

Each row shows (from top to bottom):

1. **Hex nibbles** — groups of 4 bits with their hex digit (0-F)
2. **Bit cells** — individual bits showing the bit index and current value (0 or 1)
3. **Field labels** — names of the fields that occupy those bits, or "Rsvd" for unassigned bits

The grid adjusts the number of bits per row based on your screen width.

### Interaction

- **Click** a bit cell to toggle it between 0 and 1
- **Hover** over a bit or nibble to highlight the field it belongs to
- **Hover** over a field label to highlight all its bits and the corresponding row in the field table

Fields that span multiple rows show "(cont.)" on continuation rows.

---

## The Field Table

Below the bit grid is a table showing each field's decoded value.

### Columns

| Column | Description |
|--------|-------------|
| **Name** | Field name with a color-coded left border matching the bit grid |
| **Bits** | Bit range (e.g., [7:4] or [0] for single-bit) |
| **Mask** | Hex mask showing which bits this field occupies |
| **Binary** | The field's raw bits in binary |
| **Value** | Decoded value with a type-appropriate control |
| **Description** | Field description (hidden on narrow screens) |

### Editing field values

Each field type has its own control in the Value column:

- **Flag**: Click the toggle button to flip between set and clear
- **Enum**: Select a value from the dropdown
- **Integer / Float / Fixed-point**: Type a value in the text input

Changing a field value immediately updates the raw register value and all other views.

If you enter an invalid value (e.g., a number too large for the field's bit width), the input turns red and shows a tooltip explaining the error.

---

## Register Map View

When registers have **offsets** set, a **Map** tab appears next to the **Register** tab. The map shows all registers laid out by memory address in a table format.

### Controls

- **Table width**: Choose 8b, 16b, 32b, 64b, or 128b to set how many bits per row
- **Show gaps**: Toggle whether to show empty address ranges between registers
- **Sort direction**: Toggle ascending/descending offset order

### Reading the map

- The left column shows the **hex address** of each row
- Registers are positioned at their offset within the table grid
- Each register cell shows the **name**, **width badge**, and a **field breakdown** showing how the register's bits are divided among its fields
- Registers wider than the table width span multiple rows (labeled "1/3", "2/3", etc.)

### Overlap detection

If two registers share the same address range, they're highlighted with an orange dashed border and a warning icon. The sidebar also shows an amber banner listing all overlapping registers.

### Navigation

Click any register in the map to jump to it in the Register view.

---

## Managing Registers

### Reordering

Drag registers in the sidebar using the grip handle on the left side of each item.

### Sorting by offset

Click the **Sort by Offset** button in the sidebar header to automatically sort registers by their memory offset. This button is only enabled when at least one register has an offset set.

### Deleting

Hover over a register in the sidebar and click the **x** button. A confirmation prompt appears inline — click **Yes** to confirm or **No** to cancel.

### Overlap warnings

If registers with offsets overlap in memory, an amber warning banner appears at the top of the sidebar listing the conflicts. Each overlapping register also shows a warning triangle icon.

---

## Projects

Register Viewer supports multiple projects, each containing an independent set of registers and values.

### Creating a project

Open the application menu and select **New Project**, or click **New Project** in the My Projects dialog.

### Switching projects

Open the application menu and select **My Projects** to see all your projects. Click the folder icon to open a project.

### Project settings

Each project has optional metadata you can set via **Project Settings** (in the menu or My Projects dialog):

- **Title** and **description**
- **Address unit size** (8, 16, 32, 64, or 128-bit) — controls how offsets are displayed
- **Date**, **author email**, and **link** (e.g., to a datasheet)

### Storage

All projects are saved automatically to your browser's local storage. A storage usage indicator appears in the My Projects dialog if you're approaching the limit.

---

## Cloud Save and Share

Save your project to the cloud to get a shareable link. No account is required — ownership is tracked by an anonymous token stored in your browser.

### Saving to the cloud

Click the **Save** button in the header (cloud icon). On first save, a brief explanation of cloud features appears. Your project is uploaded and you receive a shareable URL.

### Visibility

- **Private** (default) — only accessible from your browser with your owner token
- **Unlisted** — anyone with the link can view the project. Change visibility in the Share dialog or My Projects.

### Sharing

Click the **Share** button to open the share dialog. If your project is saved to the cloud and set to unlisted, you'll see a shareable URL you can copy.

For private projects, the dialog offers a button to make the project unlisted.

### Forking

When someone opens your shared link, they see a banner offering to "Save your own copy." This creates an independent fork — their edits won't affect your original.

### Syncing

After the initial cloud save, the Save button updates your cloud copy whenever you have unsaved changes. An amber dot appears on registers in the sidebar when the local copy has diverged from the cloud.

---

## Snapshot URLs

For small projects, the **Share** dialog also generates a **snapshot URL** that encodes the entire project in the link itself. No server is needed — anyone with the URL can open it and see your registers.

A character count appears below the URL. Snapshot URLs longer than ~2000 characters may not work in all browsers or messaging apps, so cloud links are recommended for larger projects.

---

## Import and Export

### Exporting

Open the application menu and select **Export**. A JSON file is downloaded containing all register definitions, field layouts, and current values.

### Importing

Open the application menu and select **Import**, then choose a `.json` file. The imported registers replace your current workspace.

After import, you'll see one of:

- **Success** — a brief notification confirming the import
- **Warning** — some registers were skipped due to validation errors (details listed)
- **Error** — the file couldn't be parsed (e.g., invalid JSON)

### Loading examples

Open the application menu and select **Examples** to browse pre-built register definitions. Select one and confirm to load it into your workspace.

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **Ctrl+B** | Toggle sidebar collapse/expand |
| **Enter** | Commit value in hex/decimal/binary inputs |
| **Escape** | Cancel field edit and restore previous value |
| **Click** or **Space/Enter** | Toggle a bit in the bit grid |
| **Tab** | Navigate between interactive elements |

In dropdown menus:

| Shortcut | Action |
|----------|--------|
| **Arrow Up/Down** | Navigate menu items |
| **Home/End** | Jump to first/last item |
| **Enter/Space** | Activate item |
| **Escape** | Close menu |

---

## Tips and Troubleshooting

### My changes aren't saving

Register Viewer auto-saves to your browser's local storage. If you clear browser data or switch browsers, your local projects will be lost. Use **Cloud Save** or **Export** to back up important work.

### The bit grid looks different than expected

The grid adjusts bits per row based on your window width. Widen your browser window to see more bits per row. Bits are always ordered MSB (left) to LSB (right).

### I see "Unknown" in an enum dropdown

This means the current raw bit value doesn't match any of the enum entries you've defined. Add a new entry for that value in the register editor, or change the register value.

### I lost my cloud projects

Cloud project ownership is tied to an anonymous token in your browser. You can download a **recovery key** from the My Projects dialog footer. Keep this key safe — it's the only way to prove ownership if you've cleared your browser's data.

### Field validation errors

If a field's bit range extends beyond the register width, or if fields overlap, the editor shows warnings. Adjust the MSB/LSB values or the register width to resolve them.

### Browser support

Register Viewer works in all modern browsers (Chrome, Firefox, Safari, Edge).
