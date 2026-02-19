import type { Field } from '../types/register';
import { toUnsigned, toSignMagnitudeBits } from './bitwise';
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
      const strInput = typeof input === 'string' ? input.trim() : '';
      const numVal = typeof input === 'string' ? parseBigInt(input) : BigInt(Math.round(Number(input)));
      switch (field.signedness) {
        case 'twos-complement':
          return toUnsigned(numVal, bitWidth);
        case 'sign-magnitude':
          if (strInput === '-0') return toSignMagnitudeBits('-0', bitWidth);
          return toSignMagnitudeBits(numVal, bitWidth);
        default: {
          const mask = (1n << BigInt(bitWidth)) - 1n;
          return numVal & mask;
        }
      }
    }

    case 'float': {
      const numVal = typeof input === 'string' ? parseFloat(input) : Number(input);
      let bits: bigint;
      switch (field.floatType) {
        case 'half':   bits = float16ToBits(numVal); break;
        case 'double': bits = float64ToBits(numVal); break;
        case 'single': bits = float32ToBits(numVal); break;
      }
      return bits;
    }

    case 'fixed-point': {
      const numVal = typeof input === 'string' ? parseFloat(input) : Number(input);
      return encodeFixedPoint(numVal, field.qFormat);
    }
  }
}

/** Parse a string as bigint, supporting 0x, 0b, 0o prefixes and plain decimal. */
function parseBigInt(s: string): bigint {
  s = s.trim();
  if (s === '') throw new SyntaxError('Cannot convert empty string to BigInt');
  if (s.startsWith('-')) {
    return -parseBigInt(s.slice(1));
  }
  if (s.startsWith('0x') || s.startsWith('0X')) return BigInt(s);
  if (s.startsWith('0b') || s.startsWith('0B')) return BigInt(s);
  if (s.startsWith('0o') || s.startsWith('0O')) return BigInt(s);
  return BigInt(s);
}
