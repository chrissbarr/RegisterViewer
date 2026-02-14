import { describe, it, expect } from 'vitest';
import {
  computeBitsPerRow,
  buildRowBits,
  bitToGridColumn,
  gridTemplateColumns,
  fieldsForRow,
} from './bit-grid-layout';
import type { Field } from '../types/register';

describe('computeBitsPerRow', () => {
  it('returns registerWidth when container is wide enough', () => {
    // 16 bits = 16*32 + 1*8 = 520px needed
    expect(computeBitsPerRow(600, 16)).toBe(16);
  });

  it('steps down by 8 when container is too narrow', () => {
    // 32 bits needs 32*32 + 3*8 = 1048px. 600px can fit 16 bits (520px).
    expect(computeBitsPerRow(600, 32)).toBe(16);
  });

  it('returns 8 as minimum', () => {
    expect(computeBitsPerRow(100, 32)).toBe(8);
  });

  it('returns registerWidth when containerPx is 0 (fallback)', () => {
    expect(computeBitsPerRow(0, 16)).toBe(16);
  });

  it('handles non-multiple-of-8 widths', () => {
    // 12 bits needs 12*32 + 1*8 = 392px
    expect(computeBitsPerRow(400, 12)).toBe(12);
    // If container is smaller, step down: 12 -> 8 (8*32 = 256px)
    expect(computeBitsPerRow(300, 12)).toBe(8);
  });

  it('handles 8-bit register', () => {
    // 8 bits = 8*32 = 256px, no gaps
    expect(computeBitsPerRow(256, 8)).toBe(8);
  });
});

describe('buildRowBits', () => {
  it('builds a single row for 8-bit register with bitsPerRow=8', () => {
    const rows = buildRowBits(8, 8);
    expect(rows).toHaveLength(1);
    expect(rows[0].bits).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(rows[0].startBit).toBe(7);
    expect(rows[0].endBit).toBe(0);
  });

  it('builds two rows for 16-bit register with bitsPerRow=8', () => {
    const rows = buildRowBits(16, 8);
    expect(rows).toHaveLength(2);
    expect(rows[0].bits).toEqual([15, 14, 13, 12, 11, 10, 9, 8]);
    expect(rows[0].startBit).toBe(15);
    expect(rows[0].endBit).toBe(8);
    expect(rows[1].bits).toEqual([7, 6, 5, 4, 3, 2, 1, 0]);
    expect(rows[1].startBit).toBe(7);
    expect(rows[1].endBit).toBe(0);
  });

  it('handles partial last row for non-multiple-of-8', () => {
    const rows = buildRowBits(12, 8);
    expect(rows).toHaveLength(2);
    expect(rows[0].bits).toEqual([11, 10, 9, 8, 7, 6, 5, 4]);
    expect(rows[1].bits).toEqual([3, 2, 1, 0]);
    expect(rows[1].startBit).toBe(3);
    expect(rows[1].endBit).toBe(0);
  });

  it('fits all bits in one row when bitsPerRow >= registerWidth', () => {
    const rows = buildRowBits(16, 16);
    expect(rows).toHaveLength(1);
    expect(rows[0].bits).toEqual([15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  });
});

describe('bitToGridColumn', () => {
  it('maps first bit (MSB) to column 1', () => {
    // Bit 15 in a 16-bit row starting at bit 15
    expect(bitToGridColumn(15, 15, 16)).toBe(1);
  });

  it('maps bits within the first byte', () => {
    // Bit 12 in a 16-bit row: posInRow=3, gridCol=3+0+1=4
    expect(bitToGridColumn(12, 15, 16)).toBe(4);
  });

  it('accounts for gap column at byte boundary', () => {
    // Bit 7 in a 16-bit row: posInRow=8, gridCol=8+1+1=10
    expect(bitToGridColumn(7, 15, 16)).toBe(10);
  });

  it('maps last bit (LSB) correctly', () => {
    // Bit 0 in a 16-bit row: posInRow=15, gridCol=15+1+1=17
    expect(bitToGridColumn(0, 15, 16)).toBe(17);
  });

  it('works for 8-bit row', () => {
    expect(bitToGridColumn(7, 7, 8)).toBe(1);
    expect(bitToGridColumn(0, 7, 8)).toBe(8);
  });

  it('accounts for partial first byte in 12-bit row', () => {
    // 12-bit row: first group is 4 bits (cols 1-4), gap (col 5), then 8 bits (cols 6-13)
    expect(bitToGridColumn(11, 11, 12)).toBe(1);  // first in partial group
    expect(bitToGridColumn(8, 11, 12)).toBe(4);   // last in partial group
    expect(bitToGridColumn(7, 11, 12)).toBe(6);   // first after gap
    expect(bitToGridColumn(0, 11, 12)).toBe(13);  // last bit
  });

  it('accounts for partial first byte in 20-bit row', () => {
    // 20-bit row: 4 bits (cols 1-4), gap, 8 bits (cols 6-13), gap, 8 bits (cols 15-22)
    expect(bitToGridColumn(19, 19, 20)).toBe(1);
    expect(bitToGridColumn(16, 19, 20)).toBe(4);  // last in partial group
    expect(bitToGridColumn(15, 19, 20)).toBe(6);  // first after first gap
    expect(bitToGridColumn(8, 19, 20)).toBe(13);  // last in second group
    expect(bitToGridColumn(7, 19, 20)).toBe(15);  // first after second gap
    expect(bitToGridColumn(0, 19, 20)).toBe(22);  // last bit
  });
});

describe('gridTemplateColumns', () => {
  it('generates for 8-bit row (no gap)', () => {
    expect(gridTemplateColumns(8)).toBe('repeat(8, 2rem)');
  });

  it('generates for 16-bit row (one gap)', () => {
    expect(gridTemplateColumns(16)).toBe('repeat(8, 2rem) 0.5rem repeat(8, 2rem)');
  });

  it('generates for 12-bit row (partial first byte)', () => {
    // 12 % 8 = 4, so first group is 4, then gap + 8
    expect(gridTemplateColumns(12)).toBe('repeat(4, 2rem) 0.5rem repeat(8, 2rem)');
  });

  it('generates for 32-bit row', () => {
    expect(gridTemplateColumns(32)).toBe(
      'repeat(8, 2rem) 0.5rem repeat(8, 2rem) 0.5rem repeat(8, 2rem) 0.5rem repeat(8, 2rem)'
    );
  });

  it('generates for 1-bit row', () => {
    expect(gridTemplateColumns(1)).toBe('2rem');
  });

  it('returns empty string for 0-bit row', () => {
    expect(gridTemplateColumns(0)).toBe('');
  });

  it('generates for 9-bit row (1-bit partial first + gap + 8)', () => {
    // 9 % 8 = 1, so first group is a single column, then gap + 8
    expect(gridTemplateColumns(9)).toBe('2rem 0.5rem repeat(8, 2rem)');
  });
});

describe('bitToGridColumn + gridTemplateColumns consistency', () => {
  // Parse a grid-template-columns string and return which 1-based columns are gap columns
  function gapColumns(gtc: string): Set<number> {
    const gaps = new Set<number>();
    let col = 1;
    for (const token of gtc.split(' ')) {
      const repeatMatch = token.match(/^repeat\((\d+),$/);
      if (repeatMatch) {
        col += Number(repeatMatch[1]);
      } else if (token === '2rem)') {
        // end of repeat — already counted
      } else if (token === '2rem') {
        col += 1;
      } else if (token === '0.5rem') {
        gaps.add(col);
        col += 1;
      }
    }
    return gaps;
  }

  it.each([8, 12, 16, 20, 24, 32])('no bit lands on a gap column for %d-bit row', (bitsInRow) => {
    const gtc = gridTemplateColumns(bitsInRow);
    const gaps = gapColumns(gtc);
    const rowStartBit = bitsInRow - 1;
    for (let bitIdx = rowStartBit; bitIdx >= 0; bitIdx--) {
      const col = bitToGridColumn(bitIdx, rowStartBit, bitsInRow);
      expect(gaps.has(col), `bit ${bitIdx} mapped to gap column ${col} in "${gtc}"`).toBe(false);
    }
  });
});

describe('fieldsForRow', () => {
  const makeField = (name: string, msb: number, lsb: number): Field => ({
    id: name,
    name,
    msb,
    lsb,
    type: 'integer',
  });

  it('includes a field fully within the row', () => {
    const row = { bits: [7, 6, 5, 4, 3, 2, 1, 0], startBit: 7, endBit: 0 };
    const fields = [makeField('A', 7, 4)];
    const result = fieldsForRow(row, fields);
    expect(result).toHaveLength(1);
    expect(result[0].field.name).toBe('A');
    expect(result[0].startCol).toBe(1);
    expect(result[0].endCol).toBe(5);
    expect(result[0].isPartial).toBe(false);
  });

  it('excludes a field outside the row', () => {
    const row = { bits: [7, 6, 5, 4, 3, 2, 1, 0], startBit: 7, endBit: 0 };
    const fields = [makeField('X', 15, 12)];
    const result = fieldsForRow(row, fields);
    expect(result).toHaveLength(0);
  });

  it('clamps a field spanning multiple rows', () => {
    // Row covers bits 15..8, field covers 11..4 (spans into next row)
    const row = { bits: [15, 14, 13, 12, 11, 10, 9, 8], startBit: 15, endBit: 8 };
    const fields = [makeField('B', 11, 4)];
    const result = fieldsForRow(row, fields);
    expect(result).toHaveLength(1);
    expect(result[0].isPartial).toBe(true);
    // Clamped to 11..8 in this row
    expect(result[0].startCol).toBe(bitToGridColumn(11, 15, 8));
    expect(result[0].endCol).toBe(bitToGridColumn(8, 15, 8) + 1);
  });

  it('returns multiple fields overlapping the row', () => {
    const row = { bits: [7, 6, 5, 4, 3, 2, 1, 0], startBit: 7, endBit: 0 };
    const fields = [makeField('A', 7, 4), makeField('B', 3, 0)];
    const result = fieldsForRow(row, fields);
    expect(result).toHaveLength(2);
  });

  it('preserves fieldIndex from the original fields array', () => {
    const row = { bits: [7, 6, 5, 4, 3, 2, 1, 0], startBit: 7, endBit: 0 };
    const fields = [makeField('X', 15, 12), makeField('A', 7, 4)];
    const result = fieldsForRow(row, fields);
    expect(result).toHaveLength(1);
    expect(result[0].fieldIndex).toBe(1);
  });

  it('computes correct column spans in a 12-bit row', () => {
    // 12-bit row: partial first group (4 bits: cols 1-4), gap (col 5), full group (8 bits: cols 6-13)
    const bits = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    const row = { bits, startBit: 11, endBit: 0 };
    const fields = [makeField('HIGH', 11, 8), makeField('LOW', 7, 0)];
    const result = fieldsForRow(row, fields);
    expect(result).toHaveLength(2);
    // HIGH spans cols 1-4 (the partial first group)
    expect(result[0].startCol).toBe(1);
    expect(result[0].endCol).toBe(5);
    // LOW spans cols 6-13 (after the gap)
    expect(result[1].startCol).toBe(6);
    expect(result[1].endCol).toBe(14);
  });
});
