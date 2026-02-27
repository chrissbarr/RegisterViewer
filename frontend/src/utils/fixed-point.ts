import type { QFormat } from '../types/register';
import { toSigned, toUnsigned } from './bitwise';

/**
 * Decode a Qm.n fixed-point value from raw bits.
 * The total bit width is m + n. The value is always treated as signed.
 * Result = signed_integer_value / 2^n
 */
export function decodeFixedPoint(rawBits: bigint, q: QFormat): number {
  const totalBits = q.m + q.n;
  const signedValue = toSigned(rawBits, totalBits);
  return Number(signedValue) / Math.pow(2, q.n);
}

/**
 * Encode a floating-point number into Qm.n fixed-point raw bits.
 * Result is rounded to the nearest representable value.
 */
export function encodeFixedPoint(value: number, q: QFormat): bigint {
  const totalBits = q.m + q.n;
  const scaled = Math.round(value * Math.pow(2, q.n));
  return toUnsigned(BigInt(scaled), totalBits);
}
