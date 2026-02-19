import { makeField, makeFlagField, makeEnumField, makeFloatField, makeFixedPointField } from '../test/helpers';
import { decodeField, formatDecodedValue } from './decode';

// ---------------------------------------------------------------------------
// decodeField — flag
// ---------------------------------------------------------------------------
describe('decodeField — flag', () => {
  it('returns true when the bit is set', () => {
    const field = makeFlagField({ msb: 0, lsb: 0 });
    const result = decodeField(0b1n, field);
    expect(result).toEqual({ type: 'flag', value: true });
  });

  it('returns false when the bit is clear', () => {
    const field = makeFlagField({ msb: 0, lsb: 0 });
    const result = decodeField(0b0n, field);
    expect(result).toEqual({ type: 'flag', value: false });
  });

  it('returns true for a multi-bit flag with any non-zero value', () => {
    // field occupies bits 3..0 — value 0b0010 in those bits is non-zero
    const field = makeFlagField({ msb: 3, lsb: 0 });
    const result = decodeField(0b0010n, field);
    expect(result).toEqual({ type: 'flag', value: true });
  });
});

// ---------------------------------------------------------------------------
// decodeField — enum
// ---------------------------------------------------------------------------
describe('decodeField — enum', () => {
  const entries = [
    { value: 0, name: 'OFF' },
    { value: 1, name: 'ON' },
    { value: 2, name: 'STANDBY' },
  ];

  it('returns the matching enum name', () => {
    const field = makeEnumField({ msb: 1, lsb: 0, enumEntries: entries });
    const result = decodeField(0b01n, field);
    expect(result).toEqual({ type: 'enum', value: 1, name: 'ON' });
  });

  it('returns null name when no entry matches', () => {
    const field = makeEnumField({ msb: 1, lsb: 0, enumEntries: entries });
    const result = decodeField(0b11n, field); // value 3, not in entries
    expect(result).toEqual({ type: 'enum', value: 3, name: null });
  });

  it('returns null name when enumEntries is empty', () => {
    const field = makeEnumField({ msb: 1, lsb: 0, enumEntries: [] });
    const result = decodeField(0b10n, field);
    expect(result).toEqual({ type: 'enum', value: 2, name: null });
  });

  it('correctly decodes value 0', () => {
    const field = makeEnumField({ msb: 1, lsb: 0, enumEntries: entries });
    const result = decodeField(0n, field);
    expect(result).toEqual({ type: 'enum', value: 0, name: 'OFF' });
  });
});

// ---------------------------------------------------------------------------
// decodeField — integer
// ---------------------------------------------------------------------------
describe('decodeField — integer', () => {
  it('decodes unsigned 8-bit 0xFF as 255n', () => {
    const field = makeField({ msb: 7, lsb: 0 });
    const result = decodeField(0xFFn, field);
    expect(result).toEqual({ type: 'integer', value: 255n });
  });

  it('decodes signed positive 0x7F as 127n', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'twos-complement' });
    const result = decodeField(0x7Fn, field);
    expect(result).toEqual({ type: 'integer', value: 127n });
  });

  it('decodes signed negative 0x80 as -128n', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'twos-complement' });
    const result = decodeField(0x80n, field);
    expect(result).toEqual({ type: 'integer', value: -128n });
  });

  it('decodes signed all-ones as -1n', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'twos-complement' });
    const result = decodeField(0xFFn, field);
    expect(result).toEqual({ type: 'integer', value: -1n });
  });
});

// ---------------------------------------------------------------------------
// decodeField — integer (sign-magnitude)
// ---------------------------------------------------------------------------
describe('decodeField — integer (sign-magnitude)', () => {
  it('decodes positive value 3', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'sign-magnitude' });
    const result = decodeField(0x03n, field);
    expect(result).toEqual({ type: 'integer', value: 3n });
  });

  it('decodes negative value -3 (0x83)', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'sign-magnitude' });
    const result = decodeField(0x83n, field);
    expect(result).toEqual({ type: 'integer', value: -3n });
  });

  it('decodes negative zero (0x80) as -0', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'sign-magnitude' });
    const result = decodeField(0x80n, field);
    expect(result).toEqual({ type: 'integer', value: '-0' });
  });

  it('decodes max positive 8-bit (0x7F) as 127', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'sign-magnitude' });
    const result = decodeField(0x7Fn, field);
    expect(result).toEqual({ type: 'integer', value: 127n });
  });

  it('decodes max negative 8-bit (0xFF) as -127', () => {
    const field = makeField({ msb: 7, lsb: 0, signedness: 'sign-magnitude' });
    const result = decodeField(0xFFn, field);
    expect(result).toEqual({ type: 'integer', value: -127n });
  });
});

// ---------------------------------------------------------------------------
// decodeField — float
// ---------------------------------------------------------------------------
describe('decodeField — float', () => {
  it('decodes single-precision float (1.0)', () => {
    // IEEE 754 single: 1.0 = 0x3F800000
    const field = makeFloatField({ msb: 31, lsb: 0, floatType: 'single' });
    const result = decodeField(0x3F800000n, field);
    expect(result.type).toBe('float');
    expect((result as { value: number }).value).toBeCloseTo(1.0);
  });

  it('decodes half-precision float (1.5)', () => {
    // IEEE 754 half: 1.5 = 0x3E00
    const field = makeFloatField({ msb: 15, lsb: 0, floatType: 'half' });
    const result = decodeField(0x3E00n, field);
    expect(result.type).toBe('float');
    expect((result as { value: number }).value).toBeCloseTo(1.5);
  });

  it('decodes double-precision float (1.0)', () => {
    // IEEE 754 double: 1.0 = 0x3FF0000000000000
    const field = makeFloatField({ msb: 63, lsb: 0, floatType: 'double' });
    const result = decodeField(0x3FF0000000000000n, field);
    expect(result.type).toBe('float');
    expect((result as { value: number }).value).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// decodeField — fixed-point
// ---------------------------------------------------------------------------
describe('decodeField — fixed-point', () => {
  it('decodes Q4.4 value 0x18 as 1.5', () => {
    // Q4.4: 0x18 = 0b00011000 = 24 in unsigned; signed = 24; 24 / 2^4 = 1.5
    const field = makeFixedPointField({
      msb: 7,
      lsb: 0,
      qFormat: { m: 4, n: 4 },
    });
    const result = decodeField(0x18n, field);
    expect(result.type).toBe('fixed-point');
    expect((result as { value: number }).value).toBeCloseTo(1.5);
  });
});

// ---------------------------------------------------------------------------
// formatDecodedValue
// ---------------------------------------------------------------------------
describe('formatDecodedValue', () => {
  it('formats flag true as "true"', () => {
    expect(formatDecodedValue({ type: 'flag', value: true })).toBe('true');
  });

  it('formats flag false as "false"', () => {
    expect(formatDecodedValue({ type: 'flag', value: false })).toBe('false');
  });

  it('formats enum with name as "NAME (val)"', () => {
    expect(formatDecodedValue({ type: 'enum', value: 1, name: 'ON' })).toBe('ON (1)');
  });

  it('formats enum without name as "val"', () => {
    expect(formatDecodedValue({ type: 'enum', value: 5, name: null })).toBe('5');
  });

  it('formats integer (bigint) via toString', () => {
    expect(formatDecodedValue({ type: 'integer', value: 255n })).toBe('255');
  });

  it('formats integer (number) via toString', () => {
    expect(formatDecodedValue({ type: 'integer', value: 42 })).toBe('42');
  });

  it('formats integer -0 as "-0"', () => {
    expect(formatDecodedValue({ type: 'integer', value: '-0' })).toBe('-0');
  });

  it('formats float NaN as "NaN"', () => {
    expect(formatDecodedValue({ type: 'float', value: NaN })).toBe('NaN');
  });

  it('formats float +Infinity as "+Inf"', () => {
    expect(formatDecodedValue({ type: 'float', value: Infinity })).toBe('+Inf');
  });

  it('formats float -Infinity as "-Inf"', () => {
    expect(formatDecodedValue({ type: 'float', value: -Infinity })).toBe('-Inf');
  });

  it('formats a normal float with toPrecision(6)', () => {
    expect(formatDecodedValue({ type: 'float', value: 3.14159265 })).toBe('3.14159');
  });

  it('formats fixed-point with toFixed(4)', () => {
    expect(formatDecodedValue({ type: 'fixed-point', value: 1.5 })).toBe('1.5000');
  });
});
