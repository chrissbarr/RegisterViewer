import type { Field } from '../types/register';
import { toUnsigned } from './bitwise';
import { float16ToBits, float32ToBits, float64ToBits } from './float';
import { encodeFixedPoint } from './fixed-point';

/**
 * Encode a user-provided value into raw bits for a given field.
 * Returns the raw unsigned bits that should be placed in the field's bit range.
 */
export function encodeField(input: string | number | boolean, field: Field): bigint {
  const bitWidth = field.msb - field.lsb + 1;

  switch (field.type) {
    case 'flag':
      return input ? 1n : 0n;

    case 'enum': {
      const numVal = typeof input === 'string' ? parseInt(input, 10) : Number(input);
      if (Number.isNaN(numVal)) return 0n;
      const mask = (1n << BigInt(bitWidth)) - 1n;
      return BigInt(numVal) & mask;
    }

    case 'integer': {
      const numVal = typeof input === 'string' ? parseBigInt(input) : BigInt(Math.round(Number(input)));
      if (field.signed) {
        return toUnsigned(numVal, bitWidth);
      }
      const mask = (1n << BigInt(bitWidth)) - 1n;
      return numVal & mask;
    }

    case 'float': {
      const numVal = typeof input === 'string' ? parseFloat(input) : Number(input);
      switch (field.floatType) {
        case 'half':
          return float16ToBits(numVal);
        case 'double':
          return float64ToBits(numVal);
        case 'single':
        default:
          return float32ToBits(numVal);
      }
    }

    case 'fixed-point': {
      if (!field.qFormat) return 0n;
      const numVal = typeof input === 'string' ? parseFloat(input) : Number(input);
      return encodeFixedPoint(numVal, field.qFormat);
    }

    default:
      return 0n;
  }
}

/** Parse a string as bigint, supporting 0x, 0b, 0o prefixes and plain decimal. */
function parseBigInt(s: string): bigint {
  s = s.trim();
  if (s.startsWith('-')) {
    return -parseBigInt(s.slice(1));
  }
  if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
  if (s.startsWith('0b') || s.startsWith('0B')) return BigInt(s);
  if (s.startsWith('0o') || s.startsWith('0O')) return BigInt(s);
  return BigInt(s);
}
