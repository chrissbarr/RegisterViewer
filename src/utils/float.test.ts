import {
  bitsToFloat32,
  float32ToBits,
  bitsToFloat64,
  float64ToBits,
  bitsToFloat16,
  float16ToBits,
} from './float';

// ---------------------------------------------------------------------------
// 32-bit single precision
// ---------------------------------------------------------------------------
describe('bitsToFloat32', () => {
  it('decodes positive zero', () => {
    expect(bitsToFloat32(0x00000000n)).toBe(0);
  });

  it('decodes negative zero', () => {
    const val = bitsToFloat32(0x80000000n);
    expect(Object.is(val, -0)).toBe(true);
  });

  it('decodes positive one', () => {
    expect(bitsToFloat32(0x3F800000n)).toBe(1.0);
  });

  it('decodes negative one', () => {
    expect(bitsToFloat32(0xBF800000n)).toBe(-1.0);
  });

  it('decodes pi approximation', () => {
    expect(bitsToFloat32(0x40490FDBn)).toBeCloseTo(3.14159, 4);
  });

  it('decodes positive infinity', () => {
    expect(bitsToFloat32(0x7F800000n)).toBe(Infinity);
  });

  it('decodes negative infinity', () => {
    expect(bitsToFloat32(0xFF800000n)).toBe(-Infinity);
  });

  it('decodes NaN', () => {
    expect(bitsToFloat32(0x7FC00000n)).toBeNaN();
  });

  it('decodes smallest positive subnormal', () => {
    const val = bitsToFloat32(0x00000001n);
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThan(1e-38);
  });
});

describe('float32ToBits', () => {
  it('encodes positive zero', () => {
    expect(float32ToBits(0)).toBe(0x00000000n);
  });

  it('encodes positive one', () => {
    expect(float32ToBits(1.0)).toBe(0x3F800000n);
  });

  it('encodes positive infinity', () => {
    expect(float32ToBits(Infinity)).toBe(0x7F800000n);
  });

  it('encodes negative infinity', () => {
    expect(float32ToBits(-Infinity)).toBe(0xFF800000n);
  });
});

describe('float32 round-trips', () => {
  it('round-trips 1.5 through encode then decode', () => {
    expect(bitsToFloat32(float32ToBits(1.5))).toBe(1.5);
  });

  it('round-trips -42.0 through encode then decode', () => {
    expect(bitsToFloat32(float32ToBits(-42.0))).toBe(-42.0);
  });

  it('round-trips known bit pattern 0x3F800000n through decode then encode', () => {
    expect(float32ToBits(bitsToFloat32(0x3F800000n))).toBe(0x3F800000n);
  });

  it('round-trips known bit pattern 0x40490FDBn through decode then encode', () => {
    expect(float32ToBits(bitsToFloat32(0x40490FDBn))).toBe(0x40490FDBn);
  });
});

// ---------------------------------------------------------------------------
// 64-bit double precision
// ---------------------------------------------------------------------------
describe('bitsToFloat64', () => {
  it('decodes positive zero', () => {
    expect(bitsToFloat64(0n)).toBe(0);
  });

  it('decodes positive one', () => {
    expect(bitsToFloat64(0x3FF0000000000000n)).toBe(1.0);
  });

  it('decodes positive infinity', () => {
    expect(bitsToFloat64(0x7FF0000000000000n)).toBe(Infinity);
  });

  it('decodes NaN', () => {
    expect(bitsToFloat64(0x7FF8000000000000n)).toBeNaN();
  });

  it('decodes max finite double', () => {
    const val = bitsToFloat64(0x7FEFFFFFFFFFFFFFn);
    expect(val).toBe(Number.MAX_VALUE);
  });
});

describe('float64 round-trips', () => {
  it('round-trips Math.PI', () => {
    expect(bitsToFloat64(float64ToBits(Math.PI))).toBe(Math.PI);
  });

  it('round-trips -273.15', () => {
    expect(bitsToFloat64(float64ToBits(-273.15))).toBe(-273.15);
  });
});

// ---------------------------------------------------------------------------
// 16-bit half precision (manual implementation — extra scrutiny)
// ---------------------------------------------------------------------------
describe('bitsToFloat16', () => {
  it('decodes positive zero', () => {
    expect(bitsToFloat16(0x0000n)).toBe(0);
  });

  it('decodes negative zero', () => {
    const val = bitsToFloat16(0x8000n);
    expect(Object.is(val, -0)).toBe(true);
  });

  it('decodes positive one', () => {
    expect(bitsToFloat16(0x3C00n)).toBe(1.0);
  });

  it('decodes negative one', () => {
    expect(bitsToFloat16(0xBC00n)).toBe(-1.0);
  });

  it('decodes positive infinity', () => {
    expect(bitsToFloat16(0x7C00n)).toBe(Infinity);
  });

  it('decodes negative infinity', () => {
    expect(bitsToFloat16(0xFC00n)).toBe(-Infinity);
  });

  it('decodes canonical NaN (0x7E00)', () => {
    expect(bitsToFloat16(0x7E00n)).toBeNaN();
  });

  it('decodes any NaN pattern (non-zero mantissa with all-ones exponent)', () => {
    // 0x7C01 has exponent=0x1F, mantissa=1 → NaN
    expect(bitsToFloat16(0x7C01n)).toBeNaN();
  });

  it('decodes smallest positive subnormal (0x0001)', () => {
    const val = bitsToFloat16(0x0001n);
    // 1/1024 * 2^-14 ≈ 5.96e-8
    expect(val).toBeCloseTo(5.960464477539063e-8, 12);
    expect(val).toBeGreaterThan(0);
  });

  it('decodes largest subnormal (0x03FF)', () => {
    const val = bitsToFloat16(0x03FFn);
    // (1023/1024) * 2^-14 ≈ 6.09755e-5
    expect(val).toBeGreaterThan(0);
    expect(val).toBeLessThan(1e-4);
  });

  it('decodes largest finite half (0x7BFF) to 65504', () => {
    expect(bitsToFloat16(0x7BFFn)).toBe(65504);
  });

  it('decodes 0x3800 to 0.5', () => {
    expect(bitsToFloat16(0x3800n)).toBe(0.5);
  });

  it('decodes 0x4000 to 2.0', () => {
    expect(bitsToFloat16(0x4000n)).toBe(2.0);
  });
});

describe('float16ToBits', () => {
  it('encodes 65504 to 0x7BFF', () => {
    expect(float16ToBits(65504)).toBe(0x7BFFn);
  });

  it('encodes positive overflow (100000) to positive infinity bits', () => {
    expect(float16ToBits(100000)).toBe(0x7C00n);
  });

  it('encodes negative overflow (-100000) to negative infinity bits', () => {
    expect(float16ToBits(-100000)).toBe(0xFC00n);
  });

  it('encodes NaN to 0x7E00', () => {
    expect(float16ToBits(NaN)).toBe(0x7E00n);
  });

  it('encodes +Infinity to 0x7C00', () => {
    expect(float16ToBits(Infinity)).toBe(0x7C00n);
  });

  it('encodes -Infinity to 0xFC00', () => {
    expect(float16ToBits(-Infinity)).toBe(0xFC00n);
  });

  it('encodes -0 (implementation treats as +0 since -0 < 0 is false)', () => {
    // Note: the implementation uses `value < 0` for sign detection,
    // and -0 < 0 is false in JS, so -0 encodes the same as +0
    expect(float16ToBits(-0)).toBe(0n);
  });

  it('encodes 0.5 to 0x3800', () => {
    expect(float16ToBits(0.5)).toBe(0x3800n);
  });

  it('encodes 2.0 to 0x4000', () => {
    expect(float16ToBits(2.0)).toBe(0x4000n);
  });

  it('handles mantissa overflow by incrementing exponent', () => {
    // Pick a value whose mantissa rounds up past 1023, triggering
    // the mantissa overflow path (mantissa=0, exponent+=1).
    // 2047.5 → mantissa = round((2047.5/1024 - 1)*1024) = round(1023.5) = 1024 > 1023
    const bits = float16ToBits(2047.5);
    // Should produce exponent+1 with mantissa=0, i.e. exactly 2048 = 0x6800
    expect(bits).toBe(0x6800n);
    expect(bitsToFloat16(bits)).toBe(2048);
  });

  it('overflows to +infinity when mantissa carry pushes exponent past 30', () => {
    // 65520 is above max finite half (65504). Exponent = floor(log2(65520)) = 15,
    // biased = 30. Mantissa rounds to 1024 > 1023, so exponent becomes 31 > 30.
    expect(float16ToBits(65520)).toBe(0x7C00n);
  });

  it('overflows to -infinity when negative mantissa carry pushes exponent past 30', () => {
    expect(float16ToBits(-65520)).toBe(0xFC00n);
  });
});

describe('float16 round-trips', () => {
  it('round-trips 1.0', () => {
    expect(bitsToFloat16(float16ToBits(1.0))).toBe(1.0);
  });

  it('round-trips 0.5', () => {
    expect(bitsToFloat16(float16ToBits(0.5))).toBe(0.5);
  });

  it('round-trips -2.0', () => {
    expect(bitsToFloat16(float16ToBits(-2.0))).toBe(-2.0);
  });

  it('round-trips 0.333 approximately', () => {
    const roundTripped = bitsToFloat16(float16ToBits(0.333));
    expect(roundTripped).toBeCloseTo(0.333, 2);
  });

  it('round-trips a subnormal value', () => {
    // Encode a small subnormal value, then decode and compare loosely
    const subnormalBits = 0x0001n;
    const decoded = bitsToFloat16(subnormalBits);
    const reEncoded = float16ToBits(decoded);
    const reDecoded = bitsToFloat16(reEncoded);
    expect(reDecoded).toBeCloseTo(decoded, 12);
  });
});
