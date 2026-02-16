import type { EnumEntry, Field, FieldType, QFormat, RegisterDef } from '../types/register';

const VALID_FIELD_TYPES: ReadonlySet<string> = new Set<FieldType>([
  'flag', 'enum', 'integer', 'float', 'fixed-point',
]);

const VALID_FLOAT_TYPES: ReadonlySet<string> = new Set(['half', 'single', 'double']);

/**
 * Construct a Field from a raw parsed object, picking only known properties.
 * Assigns a new UUID if the source lacks an `id`.
 */
export function sanitizeField(raw: Record<string, unknown>): Field {
  const type = (typeof raw.type === 'string' && VALID_FIELD_TYPES.has(raw.type))
    ? raw.type as FieldType
    : 'integer';

  const field: Field = {
    id: (typeof raw.id === 'string' && raw.id) ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === 'string' ? raw.name : '',
    msb: Number.isInteger(raw.msb) ? raw.msb as number : 0,
    lsb: Number.isInteger(raw.lsb) ? raw.lsb as number : 0,
    type,
  };

  if (typeof raw.description === 'string') {
    field.description = raw.description;
  }
  if (typeof raw.signed === 'boolean') {
    field.signed = raw.signed;
  }
  if (Array.isArray(raw.enumEntries)) {
    field.enumEntries = raw.enumEntries.filter(
      (e: unknown): e is EnumEntry =>
        typeof e === 'object' && e !== null &&
        typeof (e as Record<string, unknown>).value === 'number' &&
        typeof (e as Record<string, unknown>).name === 'string'
    ).map((e) => ({ value: e.value, name: e.name }));
  }
  if (typeof raw.floatType === 'string' && VALID_FLOAT_TYPES.has(raw.floatType)) {
    field.floatType = raw.floatType as 'half' | 'single' | 'double';
  }
  if (raw.qFormat && typeof raw.qFormat === 'object' && !Array.isArray(raw.qFormat)) {
    const qf = raw.qFormat as Record<string, unknown>;
    if (Number.isInteger(qf.m) && Number.isInteger(qf.n)) {
      field.qFormat = { m: qf.m as number, n: qf.n as number } satisfies QFormat;
    }
  }
  if (raw.flagLabels && typeof raw.flagLabels === 'object' && !Array.isArray(raw.flagLabels)) {
    const fl = raw.flagLabels as Record<string, unknown>;
    if (typeof fl.clear === 'string' && typeof fl.set === 'string') {
      field.flagLabels = { clear: fl.clear, set: fl.set };
    }
  }

  return field;
}

/**
 * Construct a RegisterDef from a raw parsed object, picking only known properties.
 * Assigns a new UUID if the source lacks an `id`.
 */
export function sanitizeRegisterDef(raw: Record<string, unknown>): RegisterDef {
  const rawFields = Array.isArray(raw.fields)
    ? raw.fields.filter((f: unknown): f is Record<string, unknown> =>
        typeof f === 'object' && f !== null
      )
    : [];

  const reg: RegisterDef = {
    id: (typeof raw.id === 'string' && raw.id) ? raw.id : crypto.randomUUID(),
    name: typeof raw.name === 'string' ? raw.name : '',
    width: Number.isInteger(raw.width) ? raw.width as number : 0,
    fields: rawFields.map((f) => sanitizeField(f)),
  };

  if (typeof raw.description === 'string') {
    reg.description = raw.description;
  }
  if (Number.isInteger(raw.offset)) {
    reg.offset = raw.offset as number;
  }

  return reg;
}
