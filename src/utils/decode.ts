import type { Field, DecodedValue } from '../types/register';
import { extractBits, toSigned } from './bitwise';
import { bitsToFloat16, bitsToFloat32, bitsToFloat64 } from './float';
import { decodeFixedPoint } from './fixed-point';

/** Decode a field's value from a full register value. */
export function decodeField(registerValue: bigint, field: Field): DecodedValue {
  const rawBits = extractBits(registerValue, field.msb, field.lsb);
  const bitWidth = field.msb - field.lsb + 1;

  switch (field.type) {
    case 'flag':
      return { type: 'flag', value: rawBits !== 0n };

    case 'enum': {
      const numVal = Number(rawBits);
      const entry = field.enumEntries.find((e) => e.value === numVal);
      return { type: 'enum', value: numVal, name: entry?.name ?? null };
    }

    case 'integer': {
      const value = field.signed ? toSigned(rawBits, bitWidth) : rawBits;
      return { type: 'integer', value };
    }

    case 'float': {
      let value: number;
      switch (field.floatType) {
        case 'half':
          value = bitsToFloat16(rawBits);
          break;
        case 'double':
          value = bitsToFloat64(rawBits);
          break;
        case 'single':
          value = bitsToFloat32(rawBits);
          break;
      }
      return { type: 'float', value };
    }

    case 'fixed-point':
      return { type: 'fixed-point', value: decodeFixedPoint(rawBits, field.qFormat) };
  }
}

/** Format a decoded value as a display string. */
export function formatDecodedValue(decoded: DecodedValue): string {
  switch (decoded.type) {
    case 'flag':
      return decoded.value ? 'true' : 'false';
    case 'enum':
      return decoded.name ? `${decoded.name} (${decoded.value})` : `${decoded.value}`;
    case 'integer':
      return decoded.value.toString();
    case 'float':
      if (Number.isNaN(decoded.value)) return 'NaN';
      if (!Number.isFinite(decoded.value)) return decoded.value > 0 ? '+Inf' : '-Inf';
      return decoded.value.toPrecision(6);
    case 'fixed-point':
      return decoded.value.toFixed(4);
  }
}
