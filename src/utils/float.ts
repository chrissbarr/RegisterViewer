/**
 * IEEE 754 float encode/decode using DataView for single and double precision.
 * Manual implementation for half precision (16-bit).
 */

// --- Single precision (32-bit) ---

export function bitsToFloat32(bits: bigint): number {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setUint32(0, Number(bits & 0xFFFFFFFFn));
  return view.getFloat32(0);
}

export function float32ToBits(value: number): bigint {
  const buf = new ArrayBuffer(4);
  const view = new DataView(buf);
  view.setFloat32(0, value);
  return BigInt(view.getUint32(0));
}

// --- Double precision (64-bit) ---

export function bitsToFloat64(bits: bigint): number {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, bits & 0xFFFFFFFFFFFFFFFFn);
  return view.getFloat64(0);
}

export function float64ToBits(value: number): bigint {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

// --- Half precision (16-bit, IEEE 754-2008) ---

export function bitsToFloat16(bits: bigint): number {
  const h = Number(bits & 0xFFFFn);
  const sign = (h >> 15) & 1;
  const exponent = (h >> 10) & 0x1F;
  const mantissa = h & 0x3FF;

  let value: number;
  if (exponent === 0) {
    // Subnormal or zero
    value = (mantissa / 1024) * Math.pow(2, -14);
  } else if (exponent === 0x1F) {
    // Infinity or NaN
    value = mantissa === 0 ? Infinity : NaN;
  } else {
    // Normal
    value = (1 + mantissa / 1024) * Math.pow(2, exponent - 15);
  }

  return sign ? -value : value;
}

export function float16ToBits(value: number): bigint {
  if (Number.isNaN(value)) return 0x7E00n; // NaN
  if (!Number.isFinite(value)) return value > 0 ? 0x7C00n : 0xFC00n; // +/- Infinity

  const sign = value < 0 ? 1 : 0;
  value = Math.abs(value);

  if (value === 0) return sign ? 0x8000n : 0n;

  // Convert to half-precision
  let exponent = Math.floor(Math.log2(value));
  let mantissa: number;

  if (exponent < -14) {
    // Subnormal
    mantissa = Math.round(value / Math.pow(2, -14) * 1024);
    exponent = 0;
  } else if (exponent > 15) {
    // Overflow → infinity
    return sign ? 0xFC00n : 0x7C00n;
  } else {
    mantissa = Math.round((value / Math.pow(2, exponent) - 1) * 1024);
    exponent = exponent + 15;
    if (mantissa > 1023) {
      mantissa = 0;
      exponent += 1;
      if (exponent > 30) return sign ? 0xFC00n : 0x7C00n;
    }
  }

  const bits = (sign << 15) | (exponent << 10) | (mantissa & 0x3FF);
  return BigInt(bits);
}
