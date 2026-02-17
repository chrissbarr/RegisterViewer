import type { Field, FieldType, RegisterDef } from '../types/register';

export interface ValidationError {
  fieldId?: string;
  message: string;
}

/** Validate a register definition. Returns an array of errors (empty = valid). */
export function validateRegisterDef(reg: RegisterDef): ValidationError[] {
  const errors: ValidationError[] = [];

  if (reg.width < 1 || reg.width > 256) {
    errors.push({ message: `Register width must be between 1 and 256 (got ${reg.width})` });
  }

  if (!reg.name.trim()) {
    errors.push({ message: 'Register name is required' });
  }

  for (const field of reg.fields) {
    errors.push(...validateField(field, reg.width));
  }

  // Check for overlapping bit ranges
  const overlaps = findOverlaps(reg.fields);
  for (const [a, b] of overlaps) {
    errors.push({
      message: `Fields "${a.name}" [${a.msb}:${a.lsb}] and "${b.name}" [${b.msb}:${b.lsb}] overlap`,
    });
  }

  return errors;
}

function validateField(field: Field, regWidth: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const id = field.id;

  if (!field.name.trim()) {
    errors.push({ fieldId: id, message: 'Field name is required' });
  }

  if (field.msb < field.lsb) {
    errors.push({ fieldId: id, message: `MSB (${field.msb}) must be >= LSB (${field.lsb})` });
  }

  if (field.msb >= regWidth) {
    errors.push({ fieldId: id, message: `MSB (${field.msb}) exceeds register width (${regWidth})` });
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
      errors.push({ fieldId: id, message: `${field.floatType ?? 'single'} float requires ${expectedWidth} bits (got ${bitWidth})` });
    }
  }

  if (field.type === 'fixed-point' && field.qFormat) {
    const expectedWidth = field.qFormat.m + field.qFormat.n;
    if (bitWidth !== expectedWidth) {
      errors.push({ fieldId: id, message: `Q${field.qFormat.m}.${field.qFormat.n} requires ${expectedWidth} bits (got ${bitWidth})` });
    }
  }

  return errors;
}

function findOverlaps(fields: Field[]): [Field, Field][] {
  const overlaps: [Field, Field][] = [];
  for (let i = 0; i < fields.length; i++) {
    for (let j = i + 1; j < fields.length; j++) {
      const a = fields[i];
      const b = fields[j];
      // Two ranges [a.lsb, a.msb] and [b.lsb, b.msb] overlap if
      // a.lsb <= b.msb AND b.lsb <= a.msb
      if (a.lsb <= b.msb && b.lsb <= a.msb) {
        overlaps.push([a, b]);
      }
    }
  }
  return overlaps;
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
