import { makeRegister } from '../test/helpers';
import {
  buildMapRegisters,
  computeMapRows,
  getOverlapWarningIds,
} from './map-layout';
import type { RegisterOverlapWarning } from './validation';

describe('getOverlapWarningIds', () => {
  it('returns empty set for no warnings', () => {
    expect(getOverlapWarningIds([])).toEqual(new Set());
  });

  it('flattens register IDs from all warnings', () => {
    const warnings: RegisterOverlapWarning[] = [
      { registerIds: ['a', 'b'], message: '' },
      { registerIds: ['c', 'a'], message: '' },
    ];
    expect(getOverlapWarningIds(warnings)).toEqual(new Set(['a', 'b', 'c']));
  });
});

describe('buildMapRegisters', () => {
  it('filters out registers without offsets', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', width: 8 }), // no offset
    ];
    const result = buildMapRegisters(regs, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].reg.id).toBe('a');
  });

  it('includes registers with offset 0', () => {
    const regs = [makeRegister({ id: 'a', offset: 0, width: 8 })];
    const result = buildMapRegisters(regs, new Set());
    expect(result).toHaveLength(1);
  });

  it('sorts by offset ascending', () => {
    const regs = [
      makeRegister({ id: 'b', offset: 4, width: 8 }),
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'c', offset: 2, width: 8 }),
    ];
    const result = buildMapRegisters(regs, new Set());
    expect(result.map((r) => r.reg.id)).toEqual(['a', 'c', 'b']);
  });

  it('assigns colorIndex as position in sorted array', () => {
    const regs = [
      makeRegister({ id: 'b', offset: 4, width: 8 }),
      makeRegister({ id: 'a', offset: 0, width: 8 }),
    ];
    const result = buildMapRegisters(regs, new Set());
    expect(result[0].colorIndex).toBe(0); // 'a' at offset 0
    expect(result[1].colorIndex).toBe(1); // 'b' at offset 4
  });

  it('computes byte size correctly', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 32 }),
      makeRegister({ id: 'b', offset: 4, width: 1 }),
    ];
    const result = buildMapRegisters(regs, new Set());
    expect(result[0].byteSize).toBe(4);
    expect(result[0].endByte).toBe(3);
    expect(result[1].byteSize).toBe(1);
    expect(result[1].endByte).toBe(4);
  });

  it('propagates overlap flag from warning IDs', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', offset: 1, width: 8 }),
    ];
    const result = buildMapRegisters(regs, new Set(['a']));
    expect(result[0].hasOverlap).toBe(true);
    expect(result[1].hasOverlap).toBe(false);
  });
});

describe('computeMapRows', () => {
  it('returns empty array for no registers', () => {
    expect(computeMapRows([], 4, true)).toEqual([]);
  });

  it('places a single 8-bit register in one row (8-bit table width)', () => {
    const mrs = buildMapRegisters(
      [makeRegister({ id: 'a', offset: 0, width: 8 })],
      new Set(),
    );
    const rows = computeMapRows(mrs, 1, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].bandStart).toBe(0);
    expect(rows[0].cells).toHaveLength(1);
    expect(rows[0].cells[0]).toMatchObject({
      kind: 'register',
      colStart: 1,
      colEnd: 2,
      rowSpanIndex: 0,
      totalRowSpans: 1,
    });
  });

  it('places four 8-bit registers side by side in one 32-bit row', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', offset: 1, width: 8 }),
      makeRegister({ id: 'c', offset: 2, width: 8 }),
      makeRegister({ id: 'd', offset: 3, width: 8 }),
    ];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(4);
    // Check columns: each occupies 1 byte
    expect(rows[0].cells[0]).toMatchObject({ kind: 'register', colStart: 1, colEnd: 2 });
    expect(rows[0].cells[1]).toMatchObject({ kind: 'register', colStart: 2, colEnd: 3 });
    expect(rows[0].cells[2]).toMatchObject({ kind: 'register', colStart: 3, colEnd: 4 });
    expect(rows[0].cells[3]).toMatchObject({ kind: 'register', colStart: 4, colEnd: 5 });
  });

  it('spans a 32-bit register across 4 rows with 8-bit table width', () => {
    const mrs = buildMapRegisters(
      [makeRegister({ id: 'a', offset: 0, width: 32 })],
      new Set(),
    );
    const rows = computeMapRows(mrs, 1, false);
    expect(rows).toHaveLength(4);
    for (let i = 0; i < 4; i++) {
      expect(rows[i].cells).toHaveLength(1);
      const cell = rows[i].cells[0];
      expect(cell).toMatchObject({
        kind: 'register',
        rowSpanIndex: i,
        totalRowSpans: 4,
        colStart: 1,
        colEnd: 2,
      });
    }
  });

  it('fills gaps between registers within a band', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', offset: 3, width: 8 }),
    ];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(3); // reg, gap, reg
    expect(rows[0].cells[0]).toMatchObject({ kind: 'register', colStart: 1, colEnd: 2 });
    expect(rows[0].cells[1]).toMatchObject({ kind: 'gap', colStart: 2, colEnd: 4 });
    expect(rows[0].cells[2]).toMatchObject({ kind: 'register', colStart: 4, colEnd: 5 });
  });

  it('creates trailing gap when register does not fill the band', () => {
    const regs = [makeRegister({ id: 'a', offset: 0, width: 8 })];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(2); // reg + trailing gap
    expect(rows[0].cells[1]).toMatchObject({ kind: 'gap', colStart: 2, colEnd: 5 });
  });

  it('shows gap rows when showGaps is true', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', offset: 8, width: 8 }),
    ];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 4, true);
    // offset 0: band [0-3] has reg a + gap
    // offset 4: band [4-7] empty → gap row
    // offset 8: band [8-11] has reg b + gap
    expect(rows).toHaveLength(3);
    expect(rows[1].isGapRow).toBe(true);
    expect(rows[1].bandStart).toBe(4);
  });

  it('omits empty bands when showGaps is false', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', offset: 8, width: 8 }),
    ];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(2);
    expect(rows[0].bandStart).toBe(0);
    expect(rows[1].bandStart).toBe(8);
  });

  it('handles non-aligned register spanning two bands', () => {
    // 2-byte register at offset 1 with 2-byte row width
    // Band [0-1]: occupies byte 1-2... wait, endByte = 1+1-1 = 1
    // Actually: width=16 → byteSize=2, endByte=2
    const regs = [makeRegister({ id: 'a', offset: 1, width: 16 })];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 2, false);
    // Band [0-1]: reg occupies byte 1 → col 2
    // Band [2-3]: reg occupies byte 2 → col 1
    expect(rows).toHaveLength(2);
    expect(rows[0].cells.find((c) => c.kind === 'register')).toMatchObject({
      colStart: 2,
      colEnd: 3,
      rowSpanIndex: 0,
    });
    expect(rows[1].cells.find((c) => c.kind === 'register')).toMatchObject({
      colStart: 1,
      colEnd: 2,
      rowSpanIndex: 1,
    });
  });

  it('register exactly filling a band produces no gaps', () => {
    const regs = [makeRegister({ id: 'a', offset: 0, width: 32 })];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(1);
    expect(rows[0].cells[0]).toMatchObject({
      kind: 'register',
      colStart: 1,
      colEnd: 5,
    });
  });

  it('handles leading gap within a band', () => {
    const regs = [makeRegister({ id: 'a', offset: 2, width: 8 })];
    const mrs = buildMapRegisters(regs, new Set());
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    // leading gap [0-1], register at col 3, trailing gap [3]
    expect(rows[0].cells[0]).toMatchObject({ kind: 'gap', colStart: 1, colEnd: 3 });
    expect(rows[0].cells[1]).toMatchObject({ kind: 'register', colStart: 3, colEnd: 4 });
    expect(rows[0].cells[2]).toMatchObject({ kind: 'gap', colStart: 4, colEnd: 5 });
  });
});
