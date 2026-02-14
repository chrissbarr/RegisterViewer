import type { Field } from '../types/register';

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
