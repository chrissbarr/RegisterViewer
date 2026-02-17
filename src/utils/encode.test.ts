import { makeField, makeFlagField, makeEnumField, makeFloatField, makeFixedPointField } from '../test/helpers';
import { encodeField } from './encode';
import { decodeField, formatDecodedValue } from './decode';

// ---------------------------------------------------------------------------
// encodeField — flag
// ---------------------------------------------------------------------------
describe('encodeField — flag', () => {
  const field = makeFlagField({ msb: 0, lsb: 0 });

  it('encodes true as 1n', () => {
    expect(encodeField(true, field)).toBe(1n);
  });

  it('encodes false as 0n', () => {
    expect(encodeField(false, field)).toBe(0n);
  });

  it('encodes a truthy string as 1n', () => {
    expect(encodeField('yes', field)).toBe(1n);
  });

  it('encodes an empty string as 0n', () => {
    expect(encodeField('', field)).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// encodeField — enum
// ---------------------------------------------------------------------------
describe('encodeField — enum', () => {
  const entries = [
    { value: 0, name: 'OFF' },
    { value: 1, name: 'ON' },
    { value: 2, name: 'STANDBY' },
  ];
  const field = makeEnumField({ msb: 1, lsb: 0, enumEntries: entries });

  it('encodes string "3" as 3n', () => {
    expect(encodeField('3', field)).toBe(3n);
  });

  it('encodes number 2 as 2n', () => {
    expect(encodeField(2, field)).toBe(2n);
  });

  it('encodes NaN string as 0n', () => {
    expect(encodeField('abc', field)).toBe(0n);
  });

  it('masks to bit width', () => {
    // 2-bit field, value 5 (0b101) → masked to 0b01 = 1n
    expect(encodeField(5, field)).toBe(1n);
  });
});

// ---------------------------------------------------------------------------
// encodeField — integer unsigned
// ---------------------------------------------------------------------------
describe('encodeField — integer unsigned', () => {
  const field = makeField({ msb: 7, lsb: 0 });

  it('encodes "42" as 42n', () => {
    expect(encodeField('42', field)).toBe(42n);
  });

  it('encodes "0xFF" as 255n', () => {
    expect(encodeField('0xFF', field)).toBe(255n);
  });

  it('encodes "0b1010" as 10n', () => {
    expect(encodeField('0b1010', field)).toBe(10n);
  });

  it('encodes "0o77" as 63n', () => {
    expect(encodeField('0o77', field)).toBe(63n);
  });

  it('masks to bit width', () => {
    // 8-bit field, value 256 (0x100) → masked to 0n
    expect(encodeField('256', field)).toBe(0n);
  });
});

// ---------------------------------------------------------------------------
// encodeField — integer signed
// ---------------------------------------------------------------------------
describe('encodeField — integer signed', () => {
  const field = makeField({ msb: 7, lsb: 0, signed: true });

  it('encodes "-1" as 255n (two\'s complement 8-bit)', () => {
    expect(encodeField('-1', field)).toBe(255n);
  });

  it('encodes "-128" as 128n (two\'s complement 8-bit)', () => {
    expect(encodeField('-128', field)).toBe(128n);
  });

  it('encodes number -5 as correct unsigned representation', () => {
    // -5 in 8-bit two's complement → 256 - 5 = 251
    expect(encodeField(-5, field)).toBe(251n);
  });
});

// ---------------------------------------------------------------------------
// encodeField — float
// ---------------------------------------------------------------------------
describe('encodeField — float', () => {
  it('encodes "1.5" as single-precision bits', () => {
    const field = makeFloatField({ msb: 31, lsb: 0, floatType: 'single' });
    // IEEE 754 single: 1.5 = 0x3FC00000
    expect(encodeField('1.5', field)).toBe(0x3FC00000n);
  });

  it('encodes "NaN" as half-precision NaN bits', () => {
    const field = makeFloatField({ msb: 15, lsb: 0, floatType: 'half' });
    expect(encodeField('NaN', field)).toBe(0x7E00n);
  });

  it('encodes Infinity as double-precision bits', () => {
    const field = makeFloatField({ msb: 63, lsb: 0, floatType: 'double' });
    expect(encodeField(Infinity, field)).toBe(0x7FF0000000000000n);
  });
});

// ---------------------------------------------------------------------------
// encodeField — fixed-point
// ---------------------------------------------------------------------------
describe('encodeField — fixed-point', () => {
  it('encodes "1.5" as Q4.4 raw bits', () => {
    const field = makeFixedPointField({
      msb: 7,
      lsb: 0,
      qFormat: { m: 4, n: 4 },
    });
    // 1.5 * 2^4 = 24 = 0x18
    expect(encodeField('1.5', field)).toBe(0x18n);
  });
});

// ---------------------------------------------------------------------------
// Round-trip: decode then encode back to the same raw value
// ---------------------------------------------------------------------------
describe('round-trip — decode then encode', () => {
  it('round-trips a flag field', () => {
    const field = makeFlagField({ msb: 0, lsb: 0 });
    const regVal = 1n;
    const decoded = decodeField(regVal, field);
    expect(decoded.type).toBe('flag');
    const encoded = encodeField((decoded as { value: boolean }).value, field);
    expect(encoded).toBe(1n);
  });

  it('round-trips an enum field', () => {
    const entries = [{ value: 2, name: 'STANDBY' }];
    const field = makeEnumField({ msb: 1, lsb: 0, enumEntries: entries });
    const regVal = 2n;
    const decoded = decodeField(regVal, field);
    expect(decoded.type).toBe('enum');
    const encoded = encodeField((decoded as { value: number }).value, field);
    expect(encoded).toBe(2n);
  });

  it('round-trips an unsigned integer field', () => {
    const field = makeField({ msb: 7, lsb: 0 });
    const regVal = 200n;
    const decoded = decodeField(regVal, field);
    expect(decoded.type).toBe('integer');
    const encoded = encodeField(Number(decoded.value), field);
    expect(encoded).toBe(200n);
  });

  it('round-trips a signed integer field', () => {
    const field = makeField({ msb: 7, lsb: 0, signed: true });
    const regVal = 0x80n; // -128 in signed 8-bit
    const decoded = decodeField(regVal, field);
    expect(decoded.type).toBe('integer');
    expect(decoded.value).toBe(-128n);
    const encoded = encodeField(Number(decoded.value), field);
    expect(encoded).toBe(0x80n);
  });

  it('round-trips a single-precision float field', () => {
    const field = makeFloatField({ msb: 31, lsb: 0, floatType: 'single' });
    const regVal = 0x3FC00000n; // 1.5
    const decoded = decodeField(regVal, field);
    expect(decoded.type).toBe('float');
    const encoded = encodeField((decoded as { value: number }).value, field);
    expect(encoded).toBe(regVal);
  });

  it('round-trips a Q4.4 fixed-point field', () => {
    const field = makeFixedPointField({
      msb: 7,
      lsb: 0,
      qFormat: { m: 4, n: 4 },
    });
    const regVal = 0x18n; // 1.5
    const decoded = decodeField(regVal, field);
    expect(decoded.type).toBe('fixed-point');
    const encoded = encodeField((decoded as { value: number }).value, field);
    expect(encoded).toBe(regVal);
  });

  it('round-trips formatDecodedValue for a normal float', () => {
    const field = makeFloatField({ msb: 31, lsb: 0, floatType: 'single' });
    const regVal = 0x3FC00000n; // 1.5
    const decoded = decodeField(regVal, field);
    const formatted = formatDecodedValue(decoded);
    // Parse the formatted string back and re-encode
    const encoded = encodeField(formatted, field);
    expect(encoded).toBe(regVal);
  });
});
