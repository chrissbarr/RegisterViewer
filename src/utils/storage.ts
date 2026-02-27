import { ADDRESS_UNIT_BITS_DEFAULT, ADDRESS_UNIT_BITS_VALUES, MAP_TABLE_WIDTH_VALUES, type AddressUnitBits, type AppState, type Field, type MapTableWidth, type ProjectMetadata, type RegisterDef, type SerializedAppState } from '../types/register';
import { sanitizeField, sanitizeRegisterDef } from './sanitize';
import { validateRegisterDef, MAX_REGISTER_WIDTH, type ValidationError } from './validation';

/** Empty serialized state with all defaults — used when creating a new blank project. */
export const EMPTY_SERIALIZED_STATE: SerializedAppState = {
  registers: [],
  activeRegisterId: null,
  registerValues: {},
  mapTableWidth: 32,
  mapShowGaps: true,
  mapSortDescending: false,
  addressUnitBits: ADDRESS_UNIT_BITS_DEFAULT,
};

export function serializeState(state: AppState): SerializedAppState {
  const serializedValues: Record<string, string> = {};
  for (const [id, value] of Object.entries(state.registerValues)) {
    serializedValues[id] = '0x' + value.toString(16);
  }
  return {
    registers: state.registers,
    activeRegisterId: state.activeRegisterId,
    registerValues: serializedValues,
    project: state.project,
    mapTableWidth: state.mapTableWidth,
    mapShowGaps: state.mapShowGaps,
    mapSortDescending: state.mapSortDescending,
    addressUnitBits: state.addressUnitBits,
  };
}

export function deserializeState(data: SerializedAppState): AppState {
  // Clamp register widths and re-sanitize fields to ensure discriminated union invariants
  const registers = data.registers.map((reg) => {
    const width = reg.width > MAX_REGISTER_WIDTH ? MAX_REGISTER_WIDTH : reg.width;
    const fields = Array.isArray(reg.fields)
      ? reg.fields.map((f) => sanitizeField(f as unknown as Record<string, unknown>))
      : [];
    return { ...reg, width, fields };
  });

  const values: Record<string, bigint> = {};
  const widthById = new Map(registers.map((r) => [r.id, r.width]));
  for (const [id, hex] of Object.entries(data.registerValues)) {
    try {
      let val = BigInt(hex);
      const width = widthById.get(id);
      if (width !== undefined) {
        const mask = (1n << BigInt(width)) - 1n;
        val = val & mask;
      }
      values[id] = val;
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[storage] Failed to parse register value for id:', id, err);
      }
      values[id] = 0n;
    }
  }
  return {
    registers,
    activeRegisterId: data.activeRegisterId,
    registerValues: values,
    project: sanitizeProjectMetadata(data.project),
    mapTableWidth: (MAP_TABLE_WIDTH_VALUES as readonly number[]).includes(data.mapTableWidth as number)
      ? data.mapTableWidth as MapTableWidth : 32,
    mapShowGaps: data.mapShowGaps !== false,
    mapSortDescending: data.mapSortDescending === true,
    addressUnitBits: typeof data.addressUnitBits === 'number' && (ADDRESS_UNIT_BITS_VALUES as readonly number[]).includes(data.addressUnitBits)
      ? data.addressUnitBits as AddressUnitBits : ADDRESS_UNIT_BITS_DEFAULT,
  };
}

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;
type ExportField = DistributiveOmit<Field, 'id'>;
type ExportRegister = Omit<RegisterDef, 'id' | 'fields'> & { fields: ExportField[] };

export function stripIds(register: RegisterDef): ExportRegister {
  const { id: _regId, fields, ...rest } = register;
  void _regId;
  const cleanFields = fields.map(({ id: _fieldId, ...fieldRest }) => {
    void _fieldId;
    return fieldRest;
  });
  return { ...rest, fields: cleanFields };
}

export function sanitizeProjectMetadata(raw: unknown): ProjectMetadata | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const result: ProjectMetadata = {};
  if (typeof obj.title === 'string' && obj.title.trim()) result.title = obj.title.trim();
  if (typeof obj.description === 'string' && obj.description.trim()) result.description = obj.description.trim();
  if (typeof obj.date === 'string' && obj.date.trim()) {
    const d = obj.date.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d))) {
      result.date = d;
    }
  }
  if (typeof obj.authorEmail === 'string' && obj.authorEmail.trim()) result.authorEmail = obj.authorEmail.trim();
  if (typeof obj.link === 'string' && obj.link.trim()) result.link = obj.link.trim();
  return Object.keys(result).length > 0 ? result : undefined;
}

/** Build the export payload as a plain object (no serialization). */
export function exportToObject(state: AppState): Record<string, unknown> {
  const cleanRegisters = state.registers.map(stripIds);
  const registerValues: Record<string, string> = {};
  for (const reg of state.registers) {
    const value = state.registerValues[reg.id];
    if (value !== undefined) {
      registerValues[reg.name] = '0x' + value.toString(16);
    }
  }
  const data: Record<string, unknown> = {
    version: 1,
    registers: cleanRegisters,
    registerValues,
  };
  if (state.project) {
    data.project = state.project;
  }
  if (state.addressUnitBits !== ADDRESS_UNIT_BITS_DEFAULT) {
    data.addressUnitBits = state.addressUnitBits;
  }
  return data;
}

export function exportToJson(state: AppState, pretty = false): string {
  const data = exportToObject(state);
  return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportWarning {
  registerIndex: number;
  registerName: string;
  errors: ValidationError[];
}

export interface ImportResult {
  registers: RegisterDef[];
  values: Record<string, bigint>;
  warnings: ImportWarning[];
  project?: ProjectMetadata;
  addressUnitBits?: AddressUnitBits;
}

export function importFromObject(data: Record<string, unknown>): ImportResult | null {
  try {
    if (!data.registers || !Array.isArray(data.registers)) return null;

    const warnings: ImportWarning[] = [];
    const validRegisters: RegisterDef[] = [];

    for (let i = 0; i < data.registers.length; i++) {
      const raw = data.registers[i];
      if (typeof raw !== 'object' || raw === null) continue;

      const reg = sanitizeRegisterDef(raw as Record<string, unknown>);
      const errors = validateRegisterDef(reg);

      if (errors.length > 0) {
        warnings.push({
          registerIndex: i,
          registerName: reg.name || `(index ${i})`,
          errors,
        });
        continue;
      }

      validRegisters.push(reg);
    }

    // Build a name-to-id lookup for resolving name-based registerValues keys
    const nameToId = new Map<string, string>();
    for (const reg of validRegisters) {
      nameToId.set(reg.name, reg.id);
    }

    const values: Record<string, bigint> = {};
    if (data.registerValues) {
      for (const [key, hex] of Object.entries(data.registerValues as Record<string, string>)) {
        // Resolve key: if it's a UUID matching a register id, use as-is;
        // otherwise treat it as a register name and map to the generated id
        let resolvedId: string | undefined;
        if (UUID_RE.test(key) && validRegisters.some((r) => r.id === key)) {
          resolvedId = key;
        } else {
          resolvedId = nameToId.get(key);
        }
        if (resolvedId) {
          try {
            values[resolvedId] = BigInt(hex);
          } catch (err) {
            if (import.meta.env.DEV) {
              console.warn('[storage] Failed to parse imported register value for key:', key, err);
            }
            values[resolvedId] = 0n;
          }
        }
      }
    }
    const project = sanitizeProjectMetadata(data.project);
    const addressUnitBits: AddressUnitBits | undefined = typeof data.addressUnitBits === 'number' && (ADDRESS_UNIT_BITS_VALUES as readonly number[]).includes(data.addressUnitBits)
      ? data.addressUnitBits as AddressUnitBits : undefined;
    return { registers: validRegisters, values, warnings, project, addressUnitBits };
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[storage] Failed to import from object:', err);
    }
    return null;
  }
}

export function importFromJson(json: string): ImportResult | null {
  try {
    return importFromObject(JSON.parse(json));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[storage] Failed to parse JSON for import:', err);
    }
    return null;
  }
}
