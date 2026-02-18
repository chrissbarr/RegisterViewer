/** Extract bits [msb:lsb] from value (inclusive, 0-indexed, msb >= lsb). */
export function extractBits(value: bigint, msb: number, lsb: number): bigint {
  const width = msb - lsb + 1;
  const mask = (1n << BigInt(width)) - 1n;
  return (value >> BigInt(lsb)) & mask;
}

/** Replace bits [msb:lsb] in value with fieldValue. */
export function replaceBits(
  value: bigint,
  msb: number,
  lsb: number,
  fieldValue: bigint,
): bigint {
  const width = msb - lsb + 1;
  const mask = ((1n << BigInt(width)) - 1n) << BigInt(lsb);
  const cleared = value & ~mask;
  const shifted = (fieldValue & ((1n << BigInt(width)) - 1n)) << BigInt(lsb);
  return cleared | shifted;
}

/** Toggle a single bit in value. */
export function toggleBit(value: bigint, bit: number): bigint {
  return value ^ (1n << BigInt(bit));
}

/** Get a single bit (0 or 1). */
export function getBit(value: bigint, bit: number): 0 | 1 {
  return ((value >> BigInt(bit)) & 1n) === 1n ? 1 : 0;
}

/** Interpret raw unsigned bits as a signed two's complement integer. */
export function toSigned(raw: bigint, bitWidth: number): bigint {
  const signBit = 1n << BigInt(bitWidth - 1);
  if ((raw & signBit) !== 0n) {
    // Negative: extend sign
    return raw - (1n << BigInt(bitWidth));
  }
  return raw;
}

/** Convert a signed value back to unsigned two's complement of given width. */
export function toUnsigned(signed: bigint, bitWidth: number): bigint {
  if (signed < 0n) {
    return signed + (1n << BigInt(bitWidth));
  }
  return signed & ((1n << BigInt(bitWidth)) - 1n);
}

/**
 * Interpret raw unsigned bits as a signed value using sign-magnitude encoding.
 * MSB is the sign bit; remaining bits are the magnitude.
 * Returns the string '-0' when the sign bit is set but magnitude is zero.
 */
export function fromSignMagnitudeBits(raw: bigint, bitWidth: number): bigint | '-0' {
  if (bitWidth < 1) return 0n;
  const signBit = 1n << BigInt(bitWidth - 1);
  const magnitudeMask = signBit - 1n;
  const magnitude = raw & magnitudeMask;
  const isNegative = (raw & signBit) !== 0n;
  if (isNegative) {
    return magnitude === 0n ? '-0' : -magnitude;
  }
  return magnitude;
}

/**
 * Encode a signed value into sign-magnitude bits.
 * Accepts the string '-0' to encode negative zero (sign bit set, magnitude zero).
 */
export function toSignMagnitudeBits(value: bigint | '-0', bitWidth: number): bigint {
  if (bitWidth < 1) return 0n;
  const signBit = 1n << BigInt(bitWidth - 1);
  const magnitudeMask = signBit - 1n;
  if (value === '-0') return signBit;
  if (value < 0n) {
    return signBit | ((-value) & magnitudeMask);
  }
  return value & magnitudeMask;
}

/** Clamp a bigint value to the range representable by a given bit width (unsigned). */
export function clampToWidth(value: bigint, width: number): bigint {
  const mask = (1n << BigInt(width)) - 1n;
  return value & mask;
}
