import { makeField, makeRegister } from '../test/helpers';
import {
  buildMapRegisters,
  computeFieldSegments,
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

  it('computes unit size correctly', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 32 }),
      makeRegister({ id: 'b', offset: 4, width: 1 }),
    ];
    const result = buildMapRegisters(regs, new Set());
    expect(result[0].unitSize).toBe(4);
    expect(result[0].endUnit).toBe(3);
    expect(result[1].unitSize).toBe(1);
    expect(result[1].endUnit).toBe(4);
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
    // Band [0-1]: occupies byte 1-2... wait, endUnit = 1+1-1 = 1
    // Actually: width=16 → unitSize=2, endUnit=2
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

  it('populates fieldSegments on register cells', () => {
    const reg = makeRegister({
      id: 'a',
      offset: 0,
      width: 16,
      fields: [
        makeField({ id: 'f1', name: 'HIGH', msb: 15, lsb: 8 }),
        makeField({ id: 'f2', name: 'LOW', msb: 7, lsb: 0 }),
      ],
    });
    const mrs = buildMapRegisters([reg], new Set());
    const rows = computeMapRows(mrs, 2, false);
    expect(rows).toHaveLength(1);
    const cell = rows[0].cells[0];
    expect(cell.kind).toBe('register');
    if (cell.kind === 'register') {
      expect(cell.fieldSegments).toHaveLength(2);
      expect(cell.fieldSegments[0]).toMatchObject({ fieldIndex: 0, widthBits: 8, isPartial: false });
      expect(cell.fieldSegments[1]).toMatchObject({ fieldIndex: 1, widthBits: 8, isPartial: false });
    }
  });
});

describe('computeFieldSegments', () => {
  it('returns empty array for register with no fields', () => {
    const reg = makeRegister({ offset: 0, width: 8, fields: [] });
    expect(computeFieldSegments(reg, 0, 0)).toEqual([]);
  });

  it('returns empty array for register with no offset', () => {
    const reg = makeRegister({ width: 8, fields: [makeField()] });
    expect(computeFieldSegments(reg, 0, 0)).toEqual([]);
  });

  it('returns full fields within a single-byte cell', () => {
    const reg = makeRegister({
      offset: 0,
      width: 8,
      fields: [
        makeField({ id: 'f1', name: 'HIGH', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'LOW', msb: 3, lsb: 0 }),
      ],
    });
    const segs = computeFieldSegments(reg, 0, 0);
    expect(segs).toHaveLength(2);
    // MSB-first order
    expect(segs[0]).toMatchObject({ fieldIndex: 0, widthBits: 4, isPartial: false });
    expect(segs[1]).toMatchObject({ fieldIndex: 1, widthBits: 4, isPartial: false });
  });

  it('marks partial fields when cell clips them', () => {
    // 16-bit register, field spans bits [15:0], but cell only covers byte 0 (bits 0-7)
    const reg = makeRegister({
      offset: 0,
      width: 16,
      fields: [makeField({ id: 'f1', name: 'WIDE', msb: 15, lsb: 0 })],
    });
    const segs = computeFieldSegments(reg, 0, 0); // only byte 0
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ widthBits: 8, isPartial: true });
  });

  it('handles single-bit field', () => {
    const reg = makeRegister({
      offset: 0,
      width: 8,
      fields: [makeField({ id: 'f1', name: 'BIT0', msb: 0, lsb: 0 })],
    });
    const segs = computeFieldSegments(reg, 0, 0);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ widthBits: 1, isPartial: false });
  });

  it('handles field spanning full register', () => {
    const reg = makeRegister({
      offset: 0,
      width: 32,
      fields: [makeField({ id: 'f1', name: 'ALL', msb: 31, lsb: 0 })],
    });
    const segs = computeFieldSegments(reg, 0, 3); // all 4 bytes
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ widthBits: 32, isPartial: false });
  });

  it('excludes fields outside the cell byte range', () => {
    const reg = makeRegister({
      offset: 0,
      width: 16,
      fields: [
        makeField({ id: 'f1', name: 'HIGH', msb: 15, lsb: 8 }),
        makeField({ id: 'f2', name: 'LOW', msb: 7, lsb: 0 }),
      ],
    });
    // Only byte 1 (bits 8-15)
    const segs = computeFieldSegments(reg, 1, 1);
    expect(segs).toHaveLength(1);
    expect(segs[0].field.name).toBe('HIGH');
    expect(segs[0]).toMatchObject({ widthBits: 8, isPartial: false });
  });

  it('handles multi-row register: each span gets correct field slice', () => {
    const reg = makeRegister({
      offset: 0,
      width: 32,
      fields: [
        makeField({ id: 'f1', name: 'TOP', msb: 31, lsb: 24 }),
        makeField({ id: 'f2', name: 'MID', msb: 23, lsb: 8 }),
        makeField({ id: 'f3', name: 'BOT', msb: 7, lsb: 0 }),
      ],
    });

    // Byte 0 (bits 0-7): only BOT
    const seg0 = computeFieldSegments(reg, 0, 0);
    expect(seg0).toHaveLength(1);
    expect(seg0[0].field.name).toBe('BOT');

    // Byte 1 (bits 8-15): only MID (partial)
    const seg1 = computeFieldSegments(reg, 1, 1);
    expect(seg1).toHaveLength(1);
    expect(seg1[0].field.name).toBe('MID');
    expect(seg1[0]).toMatchObject({ widthBits: 8, isPartial: true });

    // Bytes 2-3 (bits 16-31): MID (partial) + TOP
    const seg23 = computeFieldSegments(reg, 2, 3);
    expect(seg23).toHaveLength(2);
    expect(seg23[0].field.name).toBe('TOP');
    expect(seg23[0]).toMatchObject({ widthBits: 8, isPartial: false });
    expect(seg23[1].field.name).toBe('MID');
    expect(seg23[1]).toMatchObject({ widthBits: 8, isPartial: true });
  });

  it('provides clampedMsb/clampedLsb for gap computation', () => {
    // 16-bit register with a 4-bit field at bits [7:4] — gaps at [15:8] and [3:0]
    const reg = makeRegister({
      offset: 0,
      width: 16,
      fields: [makeField({ id: 'f1', name: 'MID', msb: 7, lsb: 4 })],
    });
    const segs = computeFieldSegments(reg, 0, 1); // full register
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ clampedMsb: 7, clampedLsb: 4, widthBits: 4 });
  });

  it('clamps bit positions to cell byte range', () => {
    // 32-bit register, field spans [23:8], cell is byte 1 only (bits 8-15)
    const reg = makeRegister({
      offset: 0,
      width: 32,
      fields: [makeField({ id: 'f1', name: 'WIDE', msb: 23, lsb: 8 })],
    });
    const segs = computeFieldSegments(reg, 1, 1);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ clampedMsb: 15, clampedLsb: 8, widthBits: 8, isPartial: true });
  });
});

describe('computeMapRows cellStartBit/cellEndBit', () => {
  it('provides cell bit range on register cells', () => {
    const reg = makeRegister({ id: 'a', offset: 0, width: 32, fields: [] });
    const mrs = buildMapRegisters([reg], new Set());
    // 16-bit row width → 2 bands
    const rows = computeMapRows(mrs, 2, false);
    expect(rows).toHaveLength(2);
    const cell0 = rows[0].cells[0];
    const cell1 = rows[1].cells[0];
    if (cell0.kind === 'register' && cell1.kind === 'register') {
      expect(cell0.cellStartBit).toBe(0);
      expect(cell0.cellEndBit).toBe(15);
      expect(cell1.cellStartBit).toBe(16);
      expect(cell1.cellEndBit).toBe(31);
    }
  });
});

describe('computeMapRows with overlapping registers', () => {
  it('places two fully overlapping registers as separate cells at the same position', () => {
    // Two 8-bit registers both at offset 0
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', offset: 0, width: 8 }),
    ];
    const mrs = buildMapRegisters(regs, new Set(['a', 'b']));
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    // Both registers appear as cells; 'b' starts at the same position as 'a'
    // so 'a' occupies col 1-2 and 'b' also gets col 1-2 (cursor doesn't advance past overlap)
    const regCells = rows[0].cells.filter((c) => c.kind === 'register');
    expect(regCells).toHaveLength(2);
    expect(regCells[0]).toMatchObject({ kind: 'register', colStart: 1, colEnd: 2 });
    expect(regCells[0].kind === 'register' && regCells[0].mapReg.reg.id).toBe('a');
    expect(regCells[1]).toMatchObject({ kind: 'register', colStart: 1, colEnd: 2 });
    expect(regCells[1].kind === 'register' && regCells[1].mapReg.reg.id).toBe('b');
  });

  it('places partially overlapping registers with correct columns', () => {
    // 16-bit register at offset 0 (units 0-1), 16-bit register at offset 1 (units 1-2)
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 16 }),
      makeRegister({ id: 'b', offset: 1, width: 16 }),
    ];
    const mrs = buildMapRegisters(regs, new Set(['a', 'b']));
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    const regCells = rows[0].cells.filter((c) => c.kind === 'register');
    expect(regCells).toHaveLength(2);
    // 'a' occupies units 0-1 → cols 1-3
    expect(regCells[0]).toMatchObject({ kind: 'register', colStart: 1, colEnd: 3 });
    // 'b' occupies units 1-2, but cursor is at 2 after 'a', so clamped start is max(1,2)=2 → cols 2-4
    // Actually sorted by clamped start: 'a' clampedStart=0, 'b' clampedStart=1
    // After 'a', cursor=2. 'b' clampedStart=1 < cursor=2, no gap inserted.
    // 'b' gets colStart = 1-0+1=2, colEnd = 2-0+2=4
    expect(regCells[1]).toMatchObject({ kind: 'register', colStart: 2, colEnd: 4 });
  });

  it('marks hasOverlap on overlapping registers from warning IDs', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 16 }),
      makeRegister({ id: 'b', offset: 1, width: 8 }),
    ];
    const mrs = buildMapRegisters(regs, new Set(['a', 'b']));
    expect(mrs[0].hasOverlap).toBe(true);
    expect(mrs[1].hasOverlap).toBe(true);
  });

  it('overlapping register spanning multiple bands appears in all relevant rows', () => {
    // 'a' is 32-bit at offset 0 (units 0-3), 'b' is 16-bit at offset 2 (units 2-3)
    // With row width 2: band [0-1] has 'a', band [2-3] has both 'a' and 'b'
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 32 }),
      makeRegister({ id: 'b', offset: 2, width: 16 }),
    ];
    const mrs = buildMapRegisters(regs, new Set(['a', 'b']));
    const rows = computeMapRows(mrs, 2, false);
    expect(rows).toHaveLength(2);

    // Band [0-1]: only 'a'
    const row0Regs = rows[0].cells.filter((c) => c.kind === 'register');
    expect(row0Regs).toHaveLength(1);
    expect(row0Regs[0].kind === 'register' && row0Regs[0].mapReg.reg.id).toBe('a');

    // Band [2-3]: both 'a' and 'b'
    const row1Regs = rows[1].cells.filter((c) => c.kind === 'register');
    expect(row1Regs).toHaveLength(2);
    const row1Ids = row1Regs.map((c) => c.kind === 'register' && c.mapReg.reg.id);
    expect(row1Ids).toContain('a');
    expect(row1Ids).toContain('b');
  });

  it('does not insert spurious gap between overlapping registers', () => {
    // Two registers sharing the same address: no gap cell should appear between them
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 8 }),
      makeRegister({ id: 'b', offset: 0, width: 8 }),
    ];
    const mrs = buildMapRegisters(regs, new Set(['a', 'b']));
    const rows = computeMapRows(mrs, 4, false);
    expect(rows).toHaveLength(1);
    // Should have: reg a, reg b, trailing gap — no gap between the two registers
    const cellKinds = rows[0].cells.map((c) => c.kind);
    expect(cellKinds).toEqual(['register', 'register', 'gap']);
  });
});

describe('addressUnitBits support', () => {
  it('buildMapRegisters: 16-bit register at offset 0 occupies 1 unit with addressUnitBits=16', () => {
    const regs = [makeRegister({ id: 'a', offset: 0, width: 16 })];
    const result = buildMapRegisters(regs, new Set(), 16);
    expect(result[0].unitSize).toBe(1);
    expect(result[0].startUnit).toBe(0);
    expect(result[0].endUnit).toBe(0);
  });

  it('buildMapRegisters: 32-bit register occupies 2 units with addressUnitBits=16', () => {
    const regs = [makeRegister({ id: 'a', offset: 0, width: 32 })];
    const result = buildMapRegisters(regs, new Set(), 16);
    expect(result[0].unitSize).toBe(2);
    expect(result[0].endUnit).toBe(1);
  });

  it('computeFieldSegments: 16-bit register fields correct with addressUnitBits=16', () => {
    const reg = makeRegister({
      offset: 0,
      width: 16,
      fields: [
        makeField({ id: 'f1', name: 'HIGH', msb: 15, lsb: 8 }),
        makeField({ id: 'f2', name: 'LOW', msb: 7, lsb: 0 }),
      ],
    });
    // Cell covers 1 address unit (offset 0), which is 16 bits
    const segs = computeFieldSegments(reg, 0, 0, 16);
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ fieldIndex: 0, widthBits: 8, isPartial: false });
    expect(segs[1]).toMatchObject({ fieldIndex: 1, widthBits: 8, isPartial: false });
  });

  it('computeMapRows: four 16-bit registers at offsets 0-3 fit in one row with addressUnitBits=16, rowWidth=4', () => {
    const regs = [
      makeRegister({ id: 'a', offset: 0, width: 16 }),
      makeRegister({ id: 'b', offset: 1, width: 16 }),
      makeRegister({ id: 'c', offset: 2, width: 16 }),
      makeRegister({ id: 'd', offset: 3, width: 16 }),
    ];
    const mrs = buildMapRegisters(regs, new Set(), 16);
    const rows = computeMapRows(mrs, 4, false, 16);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toHaveLength(4);
  });

  it('computeMapRows: cell bit ranges correct with addressUnitBits=16', () => {
    const reg = makeRegister({ id: 'a', offset: 0, width: 16, fields: [] });
    const mrs = buildMapRegisters([reg], new Set(), 16);
    const rows = computeMapRows(mrs, 2, false, 16);
    expect(rows).toHaveLength(1);
    const cell = rows[0].cells[0];
    if (cell.kind === 'register') {
      expect(cell.cellStartBit).toBe(0);
      expect(cell.cellEndBit).toBe(15);
    }
  });
});
