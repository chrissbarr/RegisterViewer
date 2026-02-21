import type { RegisterDef } from '../types/register';
import type { RegisterOverlapWarning } from './validation';

/** A register prepared for map layout with precomputed byte extents. */
export interface MapRegister {
  reg: RegisterDef;
  colorIndex: number;
  startByte: number;
  endByte: number;
  byteSize: number;
  hasOverlap: boolean;
}

/** A cell within a rendered band row. */
export type MapCell =
  | {
      kind: 'register';
      mapReg: MapRegister;
      rowSpanIndex: number;
      totalRowSpans: number;
      colStart: number; // 1-based CSS grid column
      colEnd: number; // exclusive
    }
  | {
      kind: 'gap';
      startByte: number;
      endByte: number;
      colStart: number;
      colEnd: number;
    };

/** One rendered row in the map table. */
export interface MapRow {
  bandStart: number;
  bandEnd: number;
  cells: MapCell[];
  isGapRow: boolean;
}

/** Flatten overlap warnings into a Set of register IDs for O(1) lookup. */
export function getOverlapWarningIds(
  warnings: RegisterOverlapWarning[],
): Set<string> {
  const ids = new Set<string>();
  for (const w of warnings) {
    for (const id of w.registerIds) ids.add(id);
  }
  return ids;
}

/**
 * Filter registers to those with offsets, sort by offset, and assign
 * color indices and byte extents.
 */
export function buildMapRegisters(
  registers: RegisterDef[],
  overlapWarningIds: Set<string>,
): MapRegister[] {
  return registers
    .filter((r): r is RegisterDef & { offset: number } => r.offset != null)
    .sort((a, b) => a.offset - b.offset)
    .map((reg, i) => {
      const byteSize = Math.ceil(reg.width / 8);
      return {
        reg,
        colorIndex: i,
        startByte: reg.offset,
        endByte: reg.offset + byteSize - 1,
        byteSize,
        hasOverlap: overlapWarningIds.has(reg.id),
      };
    });
}

/**
 * Compute the array of rendered map rows from sorted map registers.
 *
 * Each row represents a "band" of `rowWidthBytes` bytes. Registers are
 * placed at their byte positions within bands. Registers wider than one
 * band span multiple rows.
 */
export function computeMapRows(
  mapRegisters: MapRegister[],
  rowWidthBytes: number,
  showGaps: boolean,
): MapRow[] {
  if (mapRegisters.length === 0) return [];

  const minAddr = mapRegisters[0].startByte;
  const maxAddr = mapRegisters[mapRegisters.length - 1].endByte;
  const firstBand = Math.floor(minAddr / rowWidthBytes) * rowWidthBytes;
  const lastBand = Math.floor(maxAddr / rowWidthBytes) * rowWidthBytes;

  const rows: MapRow[] = [];

  for (
    let bandStart = firstBand;
    bandStart <= lastBand;
    bandStart += rowWidthBytes
  ) {
    const bandEnd = bandStart + rowWidthBytes - 1;

    // Find registers overlapping this band
    const overlapping = mapRegisters.filter(
      (mr) => mr.startByte <= bandEnd && mr.endByte >= bandStart,
    );

    if (overlapping.length === 0) {
      if (showGaps) {
        rows.push({ bandStart, bandEnd, cells: [], isGapRow: true });
      }
      continue;
    }

    // Build cells: walk through the band filling register cells and gap cells
    const cells: MapCell[] = [];
    let cursor = bandStart;

    // Sort overlapping by their clamped start within this band
    const sorted = [...overlapping].sort(
      (a, b) =>
        Math.max(a.startByte, bandStart) - Math.max(b.startByte, bandStart),
    );

    for (const mr of sorted) {
      const clampedStart = Math.max(mr.startByte, bandStart);
      const clampedEnd = Math.min(mr.endByte, bandEnd);

      // Gap before this register
      if (clampedStart > cursor) {
        cells.push({
          kind: 'gap',
          startByte: cursor,
          endByte: clampedStart - 1,
          colStart: cursor - bandStart + 1,
          colEnd: clampedStart - bandStart + 1,
        });
      }

      // Compute row span info
      const regFirstBand =
        Math.floor(mr.startByte / rowWidthBytes) * rowWidthBytes;
      const rowSpanIndex = (bandStart - regFirstBand) / rowWidthBytes;
      const totalRowSpans = Math.ceil(
        (mr.endByte -
          Math.floor(mr.startByte / rowWidthBytes) * rowWidthBytes +
          1) /
          rowWidthBytes,
      );

      cells.push({
        kind: 'register',
        mapReg: mr,
        rowSpanIndex,
        totalRowSpans,
        colStart: clampedStart - bandStart + 1,
        colEnd: clampedEnd - bandStart + 2,
      });

      cursor = clampedEnd + 1;
    }

    // Trailing gap
    if (cursor <= bandEnd) {
      cells.push({
        kind: 'gap',
        startByte: cursor,
        endByte: bandEnd,
        colStart: cursor - bandStart + 1,
        colEnd: bandEnd - bandStart + 2,
      });
    }

    rows.push({ bandStart, bandEnd, cells, isGapRow: false });
  }

  return rows;
}
