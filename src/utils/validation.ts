import type { Field, FieldType, RegisterDef } from '../types/register';
import { formatOffset } from './format';

/** Maximum supported register width in bits. */
export const MAX_REGISTER_WIDTH = 128;

export interface ValidationError {
  fieldId?: string;
  message: string;
}

export interface FieldWarning {
  fieldIds: string[];
  message: string;
}

/** Validate a register definition. Returns an array of errors (empty = valid). */
export function validateRegisterDef(reg: RegisterDef): ValidationError[] {
  const errors: ValidationError[] = [];

  if (reg.width < 1 || reg.width > MAX_REGISTER_WIDTH) {
    errors.push({ message: `Register width must be between 1 and ${MAX_REGISTER_WIDTH} (got ${reg.width})` });
  }

  if (!reg.name.trim()) {
    errors.push({ message: 'Register name is required' });
  }

  for (const field of reg.fields) {
    errors.push(...validateField(field));
  }

  return errors;
}

function validateField(field: Field): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = field.id;

  if (!field.name.trim()) {
    errors.push({ fieldId: id, message: 'Field name is required' });
  }

  if (field.msb < field.lsb) {
    errors.push({ fieldId: id, message: `MSB (${field.msb}) must be >= LSB (${field.lsb})` });
  }

  if (field.lsb < 0) {
    errors.push({ fieldId: id, message: `LSB cannot be negative` });
  }

  const bitWidth = field.msb - field.lsb + 1;

  if (field.type === 'flag' && bitWidth !== 1) {
    errors.push({ fieldId: id, message: `Flag field must be 1 bit wide (got ${bitWidth})` });
  }

  if (field.type === 'float') {
    const expectedWidth = field.floatType === 'half' ? 16 : field.floatType === 'double' ? 64 : 32;
    if (bitWidth !== expectedWidth) {
      errors.push({ fieldId: id, message: `${field.floatType} float requires ${expectedWidth} bits (got ${bitWidth})` });
    }
  }

  if (field.type === 'fixed-point') {
    const expectedWidth = field.qFormat.m + field.qFormat.n;
    if (bitWidth !== expectedWidth) {
      errors.push({ fieldId: id, message: `Q${field.qFormat.m}.${field.qFormat.n} requires ${expectedWidth} bits (got ${bitWidth})` });
    }
  }

  return errors;
}

/** Non-blocking warnings for field overlap and boundary issues. */
export function getFieldWarnings(reg: RegisterDef): FieldWarning[] {
  const warnings: FieldWarning[] = [];

  // Check fields exceeding register boundaries
  for (const field of reg.fields) {
    if (field.msb >= reg.width) {
      warnings.push({
        fieldIds: [field.id],
        message: `"${field.name}" MSB (${field.msb}) exceeds register width (${reg.width})`,
      });
    }
  }

  // Check for overlapping bit ranges
  for (let i = 0; i < reg.fields.length; i++) {
    for (let j = i + 1; j < reg.fields.length; j++) {
      const a = reg.fields[i];
      const b = reg.fields[j];
      if (a.lsb <= b.msb && b.lsb <= a.msb) {
        warnings.push({
          fieldIds: [a.id, b.id],
          message: `"${a.name}" [${a.msb}:${a.lsb}] and "${b.name}" [${b.msb}:${b.lsb}] overlap`,
        });
      }
    }
  }

  return warnings;
}

/**
 * Validate a user's text input for a field value.
 * Returns null if valid, or a human-readable error message if invalid.
 */
export function validateFieldInput(text: string, fieldType: FieldType): string | null {
  // Flag and enum use toggle/select controls — no free-text validation needed
  if (fieldType === 'flag' || fieldType === 'enum') return null;

  const trimmed = text.trim();
  if (trimmed === '') return 'Value required';

  if (fieldType === 'integer') {
    const pattern = /^-?(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|[0-9]+)$/;
    if (!pattern.test(trimmed)) {
      return 'Invalid integer — use decimal, 0x, 0b, or 0o';
    }
    try {
      // BigInt() doesn't natively support negative prefixed literals like -0xFF,
      // so strip the sign and negate manually (same approach as parseBigInt in encode.ts)
      const abs = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
      BigInt(abs);
    } catch {
      return 'Invalid integer';
    }
    return null;
  }

  // float and fixed-point: must be a finite number
  // Use Number() instead of parseFloat() — Number("3.14abc") returns NaN,
  // whereas parseFloat("3.14abc") silently returns 3.14.
  const num = Number(trimmed);
  if (Number.isNaN(num)) return 'Not a valid number';
  if (!Number.isFinite(num)) return 'Infinity is not accepted';
  return null;
}

export interface RegisterOverlapWarning {
  registerIds: string[];
  message: string;
}

/** Check if any two registers with offsets overlap in address space. */
export function getRegisterOverlapWarnings(
  registers: RegisterDef[],
  addressUnitBits: number = 8,
): RegisterOverlapWarning[] {
  const warnings: RegisterOverlapWarning[] = [];
  const withOffsets = registers.filter(
    (r): r is RegisterDef & { offset: number } => r.offset != null,
  );

  const unitLabel = addressUnitBits === 8 ? 'B' : `×${addressUnitBits}b`;

  for (let i = 0; i < withOffsets.length; i++) {
    for (let j = i + 1; j < withOffsets.length; j++) {
      const a = withOffsets[i];
      const b = withOffsets[j];
      const aUnits = Math.ceil(a.width / addressUnitBits);
      const bUnits = Math.ceil(b.width / addressUnitBits);
      const aEnd = a.offset + aUnits - 1;
      const bEnd = b.offset + bUnits - 1;
      if (a.offset <= bEnd && b.offset <= aEnd) {
        warnings.push({
          registerIds: [a.id, b.id],
          message: `"${a.name}" (${formatOffset(a.offset)}, ${aUnits}${unitLabel}) overlaps "${b.name}" (${formatOffset(b.offset)}, ${bUnits}${unitLabel})`,
        });
      }
    }
  }
  return warnings;
}
