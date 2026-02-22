import { LIMITS, type ValidationResult } from './types';

/**
 * Validate incoming project data from a create or update request.
 *
 * Validates structural constraints (types, sizes, required fields) but does
 * NOT validate register field semantics (bit range overlaps, msb >= lsb, etc.).
 * Semantic validation is the frontend's responsibility.
 */
export function validateProjectData(data: unknown): ValidationResult {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Request body must be a JSON object' };
  }

  const obj = data as Record<string, unknown>;

  // ---- version ----
  if (obj.version !== 1) {
    return { valid: false, error: 'version must be 1' };
  }

  // ---- registers ----
  if (!Array.isArray(obj.registers)) {
    return { valid: false, error: 'registers must be an array' };
  }
  if (obj.registers.length < 1) {
    return { valid: false, error: 'registers must contain at least 1 register' };
  }
  if (obj.registers.length > LIMITS.MAX_REGISTERS) {
    return { valid: false, error: `registers must contain at most ${LIMITS.MAX_REGISTERS} registers` };
  }

  for (let i = 0; i < obj.registers.length; i++) {
    const regResult = validateRegister(obj.registers[i], i);
    if (!regResult.valid) return regResult;
  }

  // ---- registerValues ----
  if (obj.registerValues === undefined || obj.registerValues === null || typeof obj.registerValues !== 'object' || Array.isArray(obj.registerValues)) {
    return { valid: false, error: 'registerValues must be an object' };
  }

  const values = obj.registerValues as Record<string, unknown>;
  for (const [key, val] of Object.entries(values)) {
    if (typeof val !== 'string') {
      return { valid: false, error: `registerValues["${key}"] must be a string` };
    }
    if (!/^0x[0-9a-fA-F]+$/.test(val) && val !== '0x0') {
      return { valid: false, error: `registerValues["${key}"] must be a hex string (e.g. "0xFF")` };
    }
  }

  // ---- project (optional metadata) ----
  if (obj.project !== undefined) {
    const metaResult = validateProjectMetadata(obj.project);
    if (!metaResult.valid) return metaResult;
  }

  // ---- addressUnitBits (optional) ----
  if (obj.addressUnitBits !== undefined) {
    if (typeof obj.addressUnitBits !== 'number' || !LIMITS.VALID_ADDRESS_UNIT_BITS.includes(obj.addressUnitBits)) {
      return { valid: false, error: `addressUnitBits must be one of: ${LIMITS.VALID_ADDRESS_UNIT_BITS.join(', ')}` };
    }
  }

  return { valid: true };
}

function validateRegister(reg: unknown, index: number): ValidationResult {
  if (!reg || typeof reg !== 'object') {
    return { valid: false, error: `registers[${index}] must be an object` };
  }

  const r = reg as Record<string, unknown>;

  // name
  if (typeof r.name !== 'string' || r.name.length < 1) {
    return { valid: false, error: `registers[${index}].name must be a non-empty string` };
  }
  if (r.name.length > LIMITS.MAX_NAME_LENGTH) {
    return { valid: false, error: `registers[${index}].name must be at most ${LIMITS.MAX_NAME_LENGTH} characters` };
  }

  // width
  if (typeof r.width !== 'number' || !Number.isInteger(r.width) || r.width < 1 || r.width > LIMITS.MAX_REGISTER_WIDTH) {
    return { valid: false, error: `registers[${index}].width must be an integer between 1 and ${LIMITS.MAX_REGISTER_WIDTH}` };
  }

  // fields
  if (!Array.isArray(r.fields)) {
    return { valid: false, error: `registers[${index}].fields must be an array` };
  }
  if (r.fields.length > LIMITS.MAX_FIELDS_PER_REGISTER) {
    return { valid: false, error: `registers[${index}].fields must contain at most ${LIMITS.MAX_FIELDS_PER_REGISTER} fields` };
  }

  for (let j = 0; j < r.fields.length; j++) {
    const fieldResult = validateField(r.fields[j], index, j);
    if (!fieldResult.valid) return fieldResult;
  }

  // description (optional)
  if (r.description !== undefined && typeof r.description !== 'string') {
    return { valid: false, error: `registers[${index}].description must be a string` };
  }

  // offset (optional)
  if (r.offset !== undefined && (typeof r.offset !== 'number' || !Number.isInteger(r.offset) || r.offset < 0)) {
    return { valid: false, error: `registers[${index}].offset must be a non-negative integer` };
  }

  // id (optional, string)
  if (r.id !== undefined && typeof r.id !== 'string') {
    return { valid: false, error: `registers[${index}].id must be a string` };
  }

  return { valid: true };
}

function validateField(field: unknown, regIndex: number, fieldIndex: number): ValidationResult {
  const prefix = `registers[${regIndex}].fields[${fieldIndex}]`;

  if (!field || typeof field !== 'object') {
    return { valid: false, error: `${prefix} must be an object` };
  }

  const f = field as Record<string, unknown>;

  // name
  if (typeof f.name !== 'string' || f.name.length < 1) {
    return { valid: false, error: `${prefix}.name must be a non-empty string` };
  }
  if (f.name.length > LIMITS.MAX_NAME_LENGTH) {
    return { valid: false, error: `${prefix}.name must be at most ${LIMITS.MAX_NAME_LENGTH} characters` };
  }

  // type
  const validTypes = ['flag', 'enum', 'integer', 'float', 'fixed-point'];
  if (typeof f.type !== 'string' || !validTypes.includes(f.type)) {
    return { valid: false, error: `${prefix}.type must be one of: ${validTypes.join(', ')}` };
  }

  // msb, lsb
  if (typeof f.msb !== 'number' || !Number.isInteger(f.msb) || f.msb < 0) {
    return { valid: false, error: `${prefix}.msb must be a non-negative integer` };
  }
  if (typeof f.lsb !== 'number' || !Number.isInteger(f.lsb) || f.lsb < 0) {
    return { valid: false, error: `${prefix}.lsb must be a non-negative integer` };
  }

  // Enum-specific: enumEntries
  if (f.type === 'enum') {
    if (!Array.isArray(f.enumEntries)) {
      return { valid: false, error: `${prefix}.enumEntries must be an array for enum fields` };
    }
    if (f.enumEntries.length > LIMITS.MAX_ENUM_ENTRIES) {
      return { valid: false, error: `${prefix}.enumEntries must contain at most ${LIMITS.MAX_ENUM_ENTRIES} entries` };
    }
    for (let k = 0; k < f.enumEntries.length; k++) {
      const entry = f.enumEntries[k] as Record<string, unknown>;
      if (!entry || typeof entry !== 'object') {
        return { valid: false, error: `${prefix}.enumEntries[${k}] must be an object` };
      }
      if (typeof entry.value !== 'number' || !Number.isInteger(entry.value)) {
        return { valid: false, error: `${prefix}.enumEntries[${k}].value must be an integer` };
      }
      if (typeof entry.name !== 'string' || entry.name.length < 1) {
        return { valid: false, error: `${prefix}.enumEntries[${k}].name must be a non-empty string` };
      }
    }
  }

  return { valid: true };
}

function validateProjectMetadata(meta: unknown): ValidationResult {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
    return { valid: false, error: 'project metadata must be an object' };
  }

  const m = meta as Record<string, unknown>;
  const stringFields = ['title', 'description', 'date', 'authorEmail', 'link'];

  for (const field of stringFields) {
    if (m[field] !== undefined) {
      if (typeof m[field] !== 'string') {
        return { valid: false, error: `project.${field} must be a string` };
      }
      if ((m[field] as string).length > LIMITS.MAX_METADATA_STRING_LENGTH) {
        return { valid: false, error: `project.${field} must be at most ${LIMITS.MAX_METADATA_STRING_LENGTH} characters` };
      }
    }
  }

  return { valid: true };
}
