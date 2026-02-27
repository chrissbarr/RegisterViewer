import { validateRegisterDef, validateFieldInput, getFieldWarnings, getRegisterOverlapWarnings } from './validation';
import { makeRegister, makeField, makeFlagField, makeFloatField, makeFixedPointField } from '../test/helpers';

describe('register-level validation', () => {
  it('returns empty errors for a valid register', () => {
    const reg = makeRegister({ name: 'VALID', width: 32, fields: [] });
    expect(validateRegisterDef(reg)).toEqual([]);
  });

  it('returns error for width 0', () => {
    const reg = makeRegister({ width: 0 });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('width'))).toBe(true);
  });

  it('returns error for width 129', () => {
    const reg = makeRegister({ width: 129 });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('width'))).toBe(true);
  });

  it('accepts width 1 as valid', () => {
    const reg = makeRegister({ width: 1, fields: [] });
    expect(validateRegisterDef(reg)).toEqual([]);
  });

  it('accepts width 128 as valid', () => {
    const reg = makeRegister({ width: 128, fields: [] });
    expect(validateRegisterDef(reg)).toEqual([]);
  });

  it('returns error for empty name', () => {
    const reg = makeRegister({ name: '' });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('name'))).toBe(true);
  });

  it('returns error for whitespace-only name', () => {
    const reg = makeRegister({ name: '   ' });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('name'))).toBe(true);
  });
});

describe('field-level validation', () => {
  it('returns error for empty field name', () => {
    const reg = makeRegister({
      fields: [makeField({ name: '' })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('name'))).toBe(true);
  });

  it('returns error when MSB < LSB', () => {
    const reg = makeRegister({
      fields: [makeField({ msb: 2, lsb: 5 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('MSB'))).toBe(true);
  });

  it('does not return error when MSB >= register width (now a warning)', () => {
    const reg = makeRegister({
      width: 8,
      fields: [makeField({ msb: 8, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('MSB') && e.message.includes('exceeds'))).toBe(false);
  });

  it('returns error when LSB < 0', () => {
    const reg = makeRegister({
      fields: [makeField({ msb: 3, lsb: -1 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('LSB') && e.message.includes('negative'))).toBe(true);
  });

  it('returns error for flag with bitWidth != 1', () => {
    const reg = makeRegister({
      fields: [makeFlagField({ msb: 3, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('Flag') && e.message.includes('1 bit'))).toBe(true);
  });

  it('no error for flag with bitWidth == 1', () => {
    const reg = makeRegister({
      fields: [makeFlagField({ msb: 5, lsb: 5 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('Flag'))).toBe(false);
  });

  it('returns error for half float with width != 16', () => {
    const reg = makeRegister({
      width: 32,
      fields: [makeFloatField({ floatType: 'half', msb: 7, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('half') && e.message.includes('16'))).toBe(true);
  });

  it('returns error for single float with width != 32', () => {
    const reg = makeRegister({
      width: 64,
      fields: [makeFloatField({ floatType: 'single', msb: 15, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('single') && e.message.includes('32'))).toBe(true);
  });

  it('returns error for double float with width != 64', () => {
    const reg = makeRegister({
      width: 64,
      fields: [makeFloatField({ floatType: 'double', msb: 31, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('double') && e.message.includes('64'))).toBe(true);
  });

  it('returns error for fixed-point with m+n mismatch', () => {
    const reg = makeRegister({
      width: 32,
      fields: [makeFixedPointField({
        msb: 7,
        lsb: 0,
        qFormat: { m: 4, n: 2 }, // expects 6 bits but field is 8 bits
      })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('Q4.2') && e.message.includes('6'))).toBe(true);
  });

  it('no error for fixed-point with matching m+n', () => {
    const reg = makeRegister({
      width: 32,
      fields: [makeFixedPointField({
        msb: 7,
        lsb: 0,
        qFormat: { m: 4, n: 4 }, // expects 8 bits = field width
      })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('fixed-point') || e.message.includes('Q'))).toBe(false);
  });
});

describe('getFieldWarnings — overlap detection', () => {
  it('no overlapping fields produces no warnings', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 3, lsb: 0 }),
      ],
    });
    expect(getFieldWarnings(reg).some((w) => w.message.includes('overlap'))).toBe(false);
  });

  it('identical ranges produce an overlap warning', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 7, lsb: 4 }),
      ],
    });
    const warnings = getFieldWarnings(reg);
    expect(warnings.some((w) => w.message.includes('overlap'))).toBe(true);
    expect(warnings.find((w) => w.message.includes('overlap'))!.fieldIds).toEqual(['f1', 'f2']);
  });

  it('partial overlap [7:4] + [5:2] produces an overlap warning', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 5, lsb: 2 }),
      ],
    });
    expect(getFieldWarnings(reg).some((w) => w.message.includes('overlap'))).toBe(true);
  });

  it('adjacent fields [7:4] + [3:0] do not overlap', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 3, lsb: 0 }),
      ],
    });
    expect(getFieldWarnings(reg).some((w) => w.message.includes('overlap'))).toBe(false);
  });

  it('three fields where A overlaps B and B overlaps C produces two overlap warnings', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 5, lsb: 2 }),
        makeField({ id: 'f3', name: 'C', msb: 3, lsb: 0 }),
      ],
    });
    const overlapWarnings = getFieldWarnings(reg).filter((w) => w.message.includes('overlap'));
    expect(overlapWarnings).toHaveLength(2);
  });
});

describe('getFieldWarnings — boundary exceeded', () => {
  it('field within register width produces no warning', () => {
    const reg = makeRegister({
      width: 8,
      fields: [makeField({ id: 'f1', name: 'A', msb: 7, lsb: 0 })],
    });
    expect(getFieldWarnings(reg).some((w) => w.message.includes('exceeds'))).toBe(false);
  });

  it('field MSB >= register width produces a warning', () => {
    const reg = makeRegister({
      width: 8,
      fields: [makeField({ id: 'f1', name: 'A', msb: 8, lsb: 0 })],
    });
    const warnings = getFieldWarnings(reg);
    expect(warnings.some((w) => w.message.includes('exceeds'))).toBe(true);
    expect(warnings.find((w) => w.message.includes('exceeds'))!.fieldIds).toEqual(['f1']);
  });

  it('multiple fields exceeding boundary produce separate warnings', () => {
    const reg = makeRegister({
      width: 8,
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 9, lsb: 8 }),
        makeField({ id: 'f2', name: 'B', msb: 10, lsb: 9 }),
      ],
    });
    const boundaryWarnings = getFieldWarnings(reg).filter((w) => w.message.includes('exceeds'));
    expect(boundaryWarnings).toHaveLength(2);
  });
});

describe('validateFieldInput — integer', () => {
  it('rejects empty string', () => {
    expect(validateFieldInput('', 'integer')).not.toBeNull();
  });

  it('rejects whitespace-only', () => {
    expect(validateFieldInput('   ', 'integer')).not.toBeNull();
  });

  it('accepts plain decimal', () => {
    expect(validateFieldInput('42', 'integer')).toBeNull();
  });

  it('accepts negative decimal', () => {
    expect(validateFieldInput('-42', 'integer')).toBeNull();
  });

  it('accepts 0x hex', () => {
    expect(validateFieldInput('0xFF', 'integer')).toBeNull();
  });

  it('accepts 0b binary', () => {
    expect(validateFieldInput('0b1010', 'integer')).toBeNull();
  });

  it('accepts 0o octal', () => {
    expect(validateFieldInput('0o17', 'integer')).toBeNull();
  });

  it('rejects non-numeric text', () => {
    expect(validateFieldInput('abc', 'integer')).not.toBeNull();
  });

  it('rejects bare prefix 0x', () => {
    expect(validateFieldInput('0x', 'integer')).not.toBeNull();
  });

  it('rejects bare prefix 0b', () => {
    expect(validateFieldInput('0b', 'integer')).not.toBeNull();
  });

  it('rejects mixed junk like 12abc', () => {
    expect(validateFieldInput('12abc', 'integer')).not.toBeNull();
  });

  it('accepts zero', () => {
    expect(validateFieldInput('0', 'integer')).toBeNull();
  });

  it('accepts negative hex', () => {
    expect(validateFieldInput('-0xFF', 'integer')).toBeNull();
  });
});

describe('validateFieldInput — float', () => {
  it('rejects empty string', () => {
    expect(validateFieldInput('', 'float')).not.toBeNull();
  });

  it('accepts integer literal', () => {
    expect(validateFieldInput('3', 'float')).toBeNull();
  });

  it('accepts decimal', () => {
    expect(validateFieldInput('3.14', 'float')).toBeNull();
  });

  it('accepts negative decimal', () => {
    expect(validateFieldInput('-1.5', 'float')).toBeNull();
  });

  it('accepts scientific notation', () => {
    expect(validateFieldInput('1e-3', 'float')).toBeNull();
  });

  it('rejects non-numeric text', () => {
    expect(validateFieldInput('abc', 'float')).not.toBeNull();
  });

  it('rejects NaN', () => {
    expect(validateFieldInput('NaN', 'float')).not.toBeNull();
  });

  it('rejects Infinity', () => {
    expect(validateFieldInput('Infinity', 'float')).not.toBeNull();
  });

  it('rejects -Infinity', () => {
    expect(validateFieldInput('-Infinity', 'float')).not.toBeNull();
  });

  it('rejects trailing non-numeric characters', () => {
    expect(validateFieldInput('3.14abc', 'float')).not.toBeNull();
  });
});

describe('validateFieldInput — fixed-point', () => {
  it('rejects empty string', () => {
    expect(validateFieldInput('', 'fixed-point')).not.toBeNull();
  });

  it('accepts decimal', () => {
    expect(validateFieldInput('1.25', 'fixed-point')).toBeNull();
  });

  it('accepts negative', () => {
    expect(validateFieldInput('-1.5', 'fixed-point')).toBeNull();
  });

  it('rejects non-numeric', () => {
    expect(validateFieldInput('abc', 'fixed-point')).not.toBeNull();
  });

  it('rejects NaN', () => {
    expect(validateFieldInput('NaN', 'fixed-point')).not.toBeNull();
  });

  it('rejects Infinity', () => {
    expect(validateFieldInput('Infinity', 'fixed-point')).not.toBeNull();
  });
});

describe('validateFieldInput — flag/enum passthrough', () => {
  it('returns null for flag regardless of input', () => {
    expect(validateFieldInput('anything', 'flag')).toBeNull();
  });

  it('returns null for enum regardless of input', () => {
    expect(validateFieldInput('anything', 'enum')).toBeNull();
  });
});

describe('getRegisterOverlapWarnings', () => {
  it('returns no warnings when no registers have offsets', () => {
    const regs = [
      makeRegister({ name: 'A', width: 32 }),
      makeRegister({ name: 'B', width: 32 }),
    ];
    expect(getRegisterOverlapWarnings(regs)).toEqual([]);
  });

  it('returns no warnings for non-overlapping registers', () => {
    const regs = [
      makeRegister({ name: 'A', width: 32, offset: 0x00 }),
      makeRegister({ name: 'B', width: 32, offset: 0x04 }),
    ];
    expect(getRegisterOverlapWarnings(regs)).toEqual([]);
  });

  it('returns no warnings for adjacent registers (touching but not overlapping)', () => {
    const regs = [
      makeRegister({ name: 'A', width: 16, offset: 0x00 }), // bytes 0-1
      makeRegister({ name: 'B', width: 16, offset: 0x02 }), // bytes 2-3
    ];
    expect(getRegisterOverlapWarnings(regs)).toEqual([]);
  });

  it('detects overlapping registers', () => {
    const regs = [
      makeRegister({ id: 'a', name: 'A', width: 32, offset: 0x00 }), // bytes 0-3
      makeRegister({ id: 'b', name: 'B', width: 32, offset: 0x02 }), // bytes 2-5
    ];
    const warnings = getRegisterOverlapWarnings(regs);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].registerIds).toEqual(['a', 'b']);
    expect(warnings[0].message).toContain('overlaps');
  });

  it('detects complete containment as overlap', () => {
    const regs = [
      makeRegister({ id: 'a', name: 'A', width: 64, offset: 0x00 }), // bytes 0-7
      makeRegister({ id: 'b', name: 'B', width: 8, offset: 0x02 }),   // byte 2
    ];
    const warnings = getRegisterOverlapWarnings(regs);
    expect(warnings).toHaveLength(1);
  });

  it('ignores registers without offsets', () => {
    const regs = [
      makeRegister({ name: 'A', width: 32, offset: 0x00 }),
      makeRegister({ name: 'B', width: 32 }), // no offset
      makeRegister({ name: 'C', width: 32, offset: 0x02 }),
    ];
    const warnings = getRegisterOverlapWarnings(regs);
    expect(warnings).toHaveLength(1); // only A and C overlap
  });

  it('handles sub-byte widths correctly (1-bit register = 1 byte)', () => {
    const regs = [
      makeRegister({ name: 'A', width: 1, offset: 0x00 }), // ceil(1/8) = 1 byte
      makeRegister({ name: 'B', width: 8, offset: 0x00 }), // 1 byte at same offset
    ];
    const warnings = getRegisterOverlapWarnings(regs);
    expect(warnings).toHaveLength(1);
  });

  it('handles sub-byte widths correctly (9-bit register = 2 bytes)', () => {
    const regs = [
      makeRegister({ name: 'A', width: 9, offset: 0x00 }),  // ceil(9/8) = 2 bytes: 0-1
      makeRegister({ name: 'B', width: 8, offset: 0x01 }),  // 1 byte at offset 1
    ];
    const warnings = getRegisterOverlapWarnings(regs);
    expect(warnings).toHaveLength(1);
  });

  it('returns multiple warnings for multiple overlapping pairs', () => {
    const regs = [
      makeRegister({ id: 'a', name: 'A', width: 32, offset: 0x00 }), // 0-3
      makeRegister({ id: 'b', name: 'B', width: 32, offset: 0x02 }), // 2-5
      makeRegister({ id: 'c', name: 'C', width: 32, offset: 0x04 }), // 4-7
    ];
    const warnings = getRegisterOverlapWarnings(regs);
    // A overlaps B, B overlaps C
    expect(warnings).toHaveLength(2);
  });
});

describe('getRegisterOverlapWarnings — addressUnitBits', () => {
  it('16-bit registers at sequential offsets do NOT overlap with addressUnitBits=16', () => {
    const regs = [
      makeRegister({ name: 'A', width: 16, offset: 0 }),
      makeRegister({ name: 'B', width: 16, offset: 1 }),
      makeRegister({ name: 'C', width: 16, offset: 2 }),
    ];
    expect(getRegisterOverlapWarnings(regs, 16)).toEqual([]);
  });

  it('16-bit registers at sequential offsets DO overlap with addressUnitBits=8 (default)', () => {
    const regs = [
      makeRegister({ name: 'A', width: 16, offset: 0 }),
      makeRegister({ name: 'B', width: 16, offset: 1 }),
    ];
    const warnings = getRegisterOverlapWarnings(regs, 8);
    expect(warnings).toHaveLength(1);
  });

  it('32-bit register at offset 0 does not overlap 32-bit register at offset 1 with addressUnitBits=32', () => {
    const regs = [
      makeRegister({ name: 'A', width: 32, offset: 0 }),
      makeRegister({ name: 'B', width: 32, offset: 1 }),
    ];
    expect(getRegisterOverlapWarnings(regs, 32)).toEqual([]);
  });

  it('register wider than one address unit correctly spans multiple units', () => {
    const regs = [
      makeRegister({ name: 'A', width: 32, offset: 0 }), // 32/16=2 units → offsets 0-1
      makeRegister({ name: 'B', width: 16, offset: 1 }), // 16/16=1 unit → offset 1
    ];
    const warnings = getRegisterOverlapWarnings(regs, 16);
    expect(warnings).toHaveLength(1);
  });
});
