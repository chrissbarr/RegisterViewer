import { validateRegisterDef } from './validation';
import { makeRegister, makeField } from '../test/helpers';

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

  it('returns error for width 257', () => {
    const reg = makeRegister({ width: 257 });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('width'))).toBe(true);
  });

  it('accepts width 1 as valid', () => {
    const reg = makeRegister({ width: 1, fields: [] });
    expect(validateRegisterDef(reg)).toEqual([]);
  });

  it('accepts width 256 as valid', () => {
    const reg = makeRegister({ width: 256, fields: [] });
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

  it('returns error when MSB >= register width', () => {
    const reg = makeRegister({
      width: 8,
      fields: [makeField({ msb: 8, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('MSB') && e.message.includes('exceeds'))).toBe(true);
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
      fields: [makeField({ type: 'flag', msb: 3, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('Flag') && e.message.includes('1 bit'))).toBe(true);
  });

  it('no error for flag with bitWidth == 1', () => {
    const reg = makeRegister({
      fields: [makeField({ type: 'flag', msb: 5, lsb: 5 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('Flag'))).toBe(false);
  });

  it('returns error for half float with width != 16', () => {
    const reg = makeRegister({
      width: 32,
      fields: [makeField({ type: 'float', floatType: 'half', msb: 7, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('half') && e.message.includes('16'))).toBe(true);
  });

  it('returns error for single float with width != 32', () => {
    const reg = makeRegister({
      width: 64,
      fields: [makeField({ type: 'float', floatType: 'single', msb: 15, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('single') && e.message.includes('32'))).toBe(true);
  });

  it('returns error for double float with width != 64', () => {
    const reg = makeRegister({
      width: 64,
      fields: [makeField({ type: 'float', floatType: 'double', msb: 31, lsb: 0 })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('double') && e.message.includes('64'))).toBe(true);
  });

  it('returns error for fixed-point with m+n mismatch', () => {
    const reg = makeRegister({
      width: 32,
      fields: [makeField({
        type: 'fixed-point',
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
      fields: [makeField({
        type: 'fixed-point',
        msb: 7,
        lsb: 0,
        qFormat: { m: 4, n: 4 }, // expects 8 bits = field width
      })],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('fixed-point') || e.message.includes('Q'))).toBe(false);
  });
});

describe('overlap detection', () => {
  it('no overlapping fields produces no overlap error', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 3, lsb: 0 }),
      ],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('overlap'))).toBe(false);
  });

  it('identical ranges produce an overlap error', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 7, lsb: 4 }),
      ],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('overlap'))).toBe(true);
  });

  it('partial overlap [7:4] + [5:2] produces an overlap error', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 5, lsb: 2 }),
      ],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('overlap'))).toBe(true);
  });

  it('adjacent fields [7:4] + [3:0] do not overlap', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 3, lsb: 0 }),
      ],
    });
    const errors = validateRegisterDef(reg);
    expect(errors.some((e) => e.message.includes('overlap'))).toBe(false);
  });

  it('three fields where A overlaps B and B overlaps C produces two overlap errors', () => {
    const reg = makeRegister({
      fields: [
        makeField({ id: 'f1', name: 'A', msb: 7, lsb: 4 }),
        makeField({ id: 'f2', name: 'B', msb: 5, lsb: 2 }),
        makeField({ id: 'f3', name: 'C', msb: 3, lsb: 0 }),
      ],
    });
    const errors = validateRegisterDef(reg);
    const overlapErrors = errors.filter((e) => e.message.includes('overlap'));
    expect(overlapErrors).toHaveLength(2);
  });
});
