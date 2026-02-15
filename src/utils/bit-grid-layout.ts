import type { Field } from '../types/register';
import { extractBits } from './bitwise';

export interface BitRow {
  bits: number[];
  startBit: number;
  endBit: number;
}

export interface FieldInRow {
  field: Field;
  fieldIndex: number;
  startCol: number;
  endCol: number;
  isPartial: boolean;
}

/** Default cell width in pixels (matches the 2rem = 32px bit cell). */
const CELL_PX = 32;
/** Default byte-gap width in pixels (matches 0.5rem = 8px gap). */
const GAP_PX = 8;

/**
 * Compute how many bits fit in one row.
 * Tries registerWidth first; if too wide, steps down by 8 until it fits.
 * Minimum is 8.
 */
export function computeBitsPerRow(
  containerPx: number,
  registerWidth: number,
  cellPx = CELL_PX,
  gapPx = GAP_PX,
): number {
  if (containerPx <= 0) return registerWidth;

  const widthNeeded = (bits: number) => {
    const gaps = Math.max(0, Math.ceil(bits / 8) - 1);
    return bits * cellPx + gaps * gapPx;
  };

  if (widthNeeded(registerWidth) <= containerPx) return registerWidth;

  // Step down by 8 until it fits
  for (let n = registerWidth - (registerWidth % 8 || 8); n >= 8; n -= 8) {
    if (widthNeeded(n) <= containerPx) return n;
  }

  return 8;
}

/**
 * Chunk bits (MSB→LSB) into rows of `bitsPerRow` each.
 */
export function buildRowBits(registerWidth: number, bitsPerRow: number): BitRow[] {
  const rows: BitRow[] = [];
  for (let start = registerWidth - 1; start >= 0; ) {
    const end = Math.max(start - bitsPerRow + 1, 0);
    const bits: number[] = [];
    for (let i = start; i >= end; i--) {
      bits.push(i);
    }
    rows.push({ bits, startBit: start, endBit: end });
    start = end - 1;
  }
  return rows;
}

/**
 * Map a bit index to a 1-based CSS grid column, accounting for gap columns
 * inserted after every 8 bit columns.
 *
 * The first group of bit columns may be partial (for non-multiple-of-8 widths),
 * so the first gap appears after `firstGroupSize` columns, then every 8 after that.
 */
export function bitToGridColumn(bitIndex: number, rowStartBit: number, bitsInRow: number): number {
  const posInRow = rowStartBit - bitIndex;
  const firstGroupSize = bitsInRow % 8 || 8;
  if (posInRow < firstGroupSize) return posInRow + 1;
  const gapsBefore = 1 + Math.floor((posInRow - firstGroupSize) / 8);
  return posInRow + gapsBefore + 1;
}

/**
 * Build the CSS `grid-template-columns` value.
 * Inserts a gap column (0.5rem) after every 8 bit columns.
 * Handles partial first byte for non-multiple-of-8 widths.
 */
export function gridTemplateColumns(bitsInRow: number): string {
  if (bitsInRow <= 0) return '';

  const parts: string[] = [];
  let remaining = bitsInRow;

  // First group may be partial (for non-multiple-of-8 widths)
  const firstGroup = remaining % 8 || 8;
  parts.push(firstGroup === 1 ? '2rem' : `repeat(${firstGroup}, 2rem)`);
  remaining -= firstGroup;

  while (remaining > 0) {
    parts.push('0.5rem'); // gap column
    // remaining is always a multiple of 8 here (firstGroup absorbed the partial)
    parts.push(`repeat(${Math.min(remaining, 8)}, 2rem)`);
    remaining -= 8;
  }

  return parts.join(' ');
}

export interface NibbleInRow {
  nibbleIndex: number;    // Absolute nibble index (bit 0-3 = nibble 0, bit 4-7 = nibble 1, etc.)
  hexDigit: string;       // '0'-'F' — the hex digit for this nibble's current value
  startCol: number;       // CSS grid column start (1-based)
  endCol: number;         // CSS grid column end (exclusive, for grid-column shorthand)
  isPartial: boolean;     // True if this nibble has fewer than 4 bits in this row (MSB edge)
  fieldIndex: number | null; // Index into fields[] if ALL bits in the nibble belong to the same field, null otherwise
}

/**
 * Compute hex digit cells for a row of the bit grid.
 * Groups the row's bits into nibbles (4-bit groups) and extracts the hex digit
 * for each nibble from the register value.
 *
 * Nibble boundaries are absolute: bits 0-3 = nibble 0, bits 4-7 = nibble 1, etc.
 * A nibble is "partial" when the register width isn't a multiple of 4 (the MSB
 * nibble has fewer than 4 bits).
 */
export function nibblesForRow(
  row: BitRow,
  registerWidth: number,
  value: bigint,
  fields: Field[] = [],
): NibbleInRow[] {
  if (row.bits.length === 0) return [];

  const result: NibbleInRow[] = [];

  // Walk the row's bits (MSB→LSB order) and group by nibble boundary
  let currentNibbleIdx = Math.floor(row.bits[0] / 4);
  let bitsInCurrentGroup: number[] = [];

  for (const bitIdx of row.bits) {
    const nibbleIdx = Math.floor(bitIdx / 4);

    if (nibbleIdx !== currentNibbleIdx) {
      // Flush previous nibble group
      if (bitsInCurrentGroup.length > 0) {
        result.push(buildNibble(bitsInCurrentGroup, currentNibbleIdx, row, registerWidth, value, fields));
      }
      currentNibbleIdx = nibbleIdx;
      bitsInCurrentGroup = [];
    }

    bitsInCurrentGroup.push(bitIdx);
  }

  // Flush last group
  if (bitsInCurrentGroup.length > 0) {
    result.push(buildNibble(bitsInCurrentGroup, currentNibbleIdx, row, registerWidth, value, fields));
  }

  return result;
}

function buildNibble(
  bitsInGroup: number[],
  nibbleIdx: number,
  row: BitRow,
  registerWidth: number,
  value: bigint,
  fields: Field[],
): NibbleInRow {
  const fullNibbleMsb = Math.min(nibbleIdx * 4 + 3, registerWidth - 1);
  const fullNibbleLsb = nibbleIdx * 4;
  const fullNibbleWidth = fullNibbleMsb - fullNibbleLsb + 1;

  // Extract the full nibble value (even if only part of it is in this row)
  const nibbleValue = extractBits(value, fullNibbleMsb, fullNibbleLsb);
  const hexDigit = nibbleValue.toString(16).toUpperCase();

  // Grid column span: from the MSB bit in this group to the LSB bit in this group
  const groupMsb = bitsInGroup[0];
  const groupLsb = bitsInGroup[bitsInGroup.length - 1];
  const startCol = bitToGridColumn(groupMsb, row.startBit, row.bits.length);
  const endCol = bitToGridColumn(groupLsb, row.startBit, row.bits.length) + 1;

  // Partial if the full nibble is narrower than 4 bits (MSB edge of register)
  // OR if this row only contains some of the nibble's bits
  const isPartial = fullNibbleWidth < 4 || bitsInGroup.length < fullNibbleWidth;

  // Check if ALL bits in the full nibble belong to the same field
  const fieldIndex = computeNibbleFieldIndex(fullNibbleLsb, fullNibbleMsb, fields);

  return {
    nibbleIndex: nibbleIdx,
    hexDigit,
    startCol,
    endCol,
    isPartial,
    fieldIndex,
  };
}

/**
 * If every bit in [lsb..msb] belongs to the same field, return that field's
 * index in the fields array. Otherwise return null.
 */
function computeNibbleFieldIndex(lsb: number, msb: number, fields: Field[]): number | null {
  let matchIndex: number | null = null;
  for (let b = lsb; b <= msb; b++) {
    let found = false;
    for (let i = 0; i < fields.length; i++) {
      if (b >= fields[i].lsb && b <= fields[i].msb) {
        if (matchIndex === null) {
          matchIndex = i;
        } else if (matchIndex !== i) {
          return null; // mixed fields
        }
        found = true;
        break;
      }
    }
    if (!found) return null; // unassigned bit
  }
  return matchIndex;
}

export interface UnassignedRange {
  startBit: number;   // MSB of range (highest bit)
  endBit: number;     // LSB of range (lowest bit)
  startCol: number;   // CSS grid column start
  endCol: number;     // CSS grid column end (exclusive)
}

/**
 * Find contiguous unassigned bit ranges in a row and compute their grid column spans.
 * Walks bits MSB→LSB (matching row.bits order) and groups contiguous unassigned bits.
 */
export function unassignedRangesForRow(row: BitRow, fields: Field[]): UnassignedRange[] {
  // Build set of assigned bit indices within this row
  const assigned = new Set<number>();
  for (const field of fields) {
    if (field.lsb > row.startBit || field.msb < row.endBit) continue;
    const clampedMsb = Math.min(field.msb, row.startBit);
    const clampedLsb = Math.max(field.lsb, row.endBit);
    for (let b = clampedLsb; b <= clampedMsb; b++) assigned.add(b);
  }

  // Walk bits MSB→LSB and group contiguous unassigned
  const ranges: UnassignedRange[] = [];
  let rangeMsb: number | null = null;

  for (const bitIdx of row.bits) {
    if (!assigned.has(bitIdx)) {
      if (rangeMsb === null) rangeMsb = bitIdx;
    } else {
      if (rangeMsb !== null) {
        // The previous bit (bitIdx + 1) was the LSB of the unassigned range
        const rangeLsb = bitIdx + 1;
        ranges.push({
          startBit: rangeMsb,
          endBit: rangeLsb,
          startCol: bitToGridColumn(rangeMsb, row.startBit, row.bits.length),
          endCol: bitToGridColumn(rangeLsb, row.startBit, row.bits.length) + 1,
        });
        rangeMsb = null;
      }
    }
  }

  // Flush trailing range
  if (rangeMsb !== null) {
    const rangeLsb = row.endBit;
    ranges.push({
      startBit: rangeMsb,
      endBit: rangeLsb,
      startCol: bitToGridColumn(rangeMsb, row.startBit, row.bits.length),
      endCol: bitToGridColumn(rangeLsb, row.startBit, row.bits.length) + 1,
    });
  }

  return ranges;
}

/**
 * Find all fields overlapping a row and compute their CSS grid column spans.
 * Fields are clamped to the row's range. `isPartial` is true when a field
 * extends beyond the row.
 */
export function fieldsForRow(row: BitRow, fields: Field[]): FieldInRow[] {
  const result: FieldInRow[] = [];

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i];
    // Check overlap: field [msb, lsb] vs row [startBit, endBit]
    if (field.lsb > row.startBit || field.msb < row.endBit) continue;

    const clampedMsb = Math.min(field.msb, row.startBit);
    const clampedLsb = Math.max(field.lsb, row.endBit);
    const isPartial = field.msb > row.startBit || field.lsb < row.endBit;

    const startCol = bitToGridColumn(clampedMsb, row.startBit, row.bits.length);
    const endCol = bitToGridColumn(clampedLsb, row.startBit, row.bits.length) + 1;

    result.push({
      field,
      fieldIndex: i,
      startCol,
      endCol,
      isPartial,
    });
  }

  return result;
}
