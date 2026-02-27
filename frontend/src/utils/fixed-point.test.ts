import { decodeFixedPoint, encodeFixedPoint } from './fixed-point';
import type { QFormat } from '../types/register';

describe('decodeFixedPoint', () => {
  it('decodes Q4.4 with 0x18 (24) to 1.5', () => {
    const q: QFormat = { m: 4, n: 4 };
    expect(decodeFixedPoint(0x18n, q)).toBe(1.5);
  });

  it('decodes zero to 0.0', () => {
    const q: QFormat = { m: 4, n: 4 };
    expect(decodeFixedPoint(0n, q)).toBe(0.0);
  });

  it('decodes negative value Q4.4 0xF0 to -1.0', () => {
    const q: QFormat = { m: 4, n: 4 };
    // 0xF0 = 240 in unsigned 8-bit = -16 signed; -16 / 2^4 = -1.0
    expect(decodeFixedPoint(0xF0n, q)).toBe(-1.0);
  });

  it('decodes Q8.8 with 0x0180 to 1.5', () => {
    const q: QFormat = { m: 8, n: 8 };
    // 0x0180 = 384; 384 / 256 = 1.5
    expect(decodeFixedPoint(0x0180n, q)).toBe(1.5);
  });

  it('decodes Q4.4 all-ones 0xFF to -0.0625', () => {
    const q: QFormat = { m: 4, n: 4 };
    // 0xFF = 255 unsigned 8-bit = -1 signed; -1 / 16 = -0.0625
    expect(decodeFixedPoint(0xFFn, q)).toBe(-0.0625);
  });
});

describe('encodeFixedPoint', () => {
  it('encodes Q4.4 with 1.5 to 24n (0x18)', () => {
    const q: QFormat = { m: 4, n: 4 };
    expect(encodeFixedPoint(1.5, q)).toBe(24n);
  });

  it('encodes 0.0 to 0n', () => {
    const q: QFormat = { m: 4, n: 4 };
    expect(encodeFixedPoint(0.0, q)).toBe(0n);
  });

  it('encodes -1.0 Q4.4 to 240n (0xF0)', () => {
    const q: QFormat = { m: 4, n: 4 };
    // -1.0 * 16 = -16; toUnsigned(-16, 8) = 240
    expect(encodeFixedPoint(-1.0, q)).toBe(240n);
  });

  it('encodes Q8.8 with 1.5 to 384n', () => {
    const q: QFormat = { m: 8, n: 8 };
    expect(encodeFixedPoint(1.5, q)).toBe(384n);
  });

  it('rounds 1.33 in Q4.4 to nearest representable value', () => {
    const q: QFormat = { m: 4, n: 4 };
    // 1.33 * 16 = 21.28 → rounds to 21
    expect(encodeFixedPoint(1.33, q)).toBe(21n);
  });
});

describe('round-trip encode/decode', () => {
  it('round-trips 1.5 in Q4.4', () => {
    const q: QFormat = { m: 4, n: 4 };
    expect(decodeFixedPoint(encodeFixedPoint(1.5, q), q)).toBeCloseTo(1.5, 5);
  });

  it('round-trips -1.0 in Q4.4', () => {
    const q: QFormat = { m: 4, n: 4 };
    expect(decodeFixedPoint(encodeFixedPoint(-1.0, q), q)).toBeCloseTo(-1.0, 5);
  });

  it('round-trips 0.0 in Q8.8', () => {
    const q: QFormat = { m: 8, n: 8 };
    expect(decodeFixedPoint(encodeFixedPoint(0.0, q), q)).toBeCloseTo(0.0, 5);
  });

  it('round-trips 3.75 in Q8.8', () => {
    const q: QFormat = { m: 8, n: 8 };
    expect(decodeFixedPoint(encodeFixedPoint(3.75, q), q)).toBeCloseTo(3.75, 5);
  });

  it('round-trips -0.5 in Q4.4', () => {
    const q: QFormat = { m: 4, n: 4 };
    expect(decodeFixedPoint(encodeFixedPoint(-0.5, q), q)).toBeCloseTo(-0.5, 5);
  });
});
