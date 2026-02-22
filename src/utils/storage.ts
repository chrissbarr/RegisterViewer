import { SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_DEFAULT, ADDRESS_UNIT_BITS_DEFAULT, ADDRESS_UNIT_BITS_VALUES, MAP_TABLE_WIDTH_VALUES, type AddressUnitBits, type AppState, type Field, type MapTableWidth, type ProjectMetadata, type RegisterDef, type SerializedAppState } from '../types/register';
import { sanitizeField, sanitizeRegisterDef } from './sanitize';
import { validateRegisterDef, MAX_REGISTER_WIDTH, type ValidationError } from './validation';

const STORAGE_KEY = 'register-viewer-state';

export function serializeState(state: AppState): SerializedAppState {
  const serializedValues: Record<string, string> = {};
  for (const [id, value] of Object.entries(state.registerValues)) {
    serializedValues[id] = '0x' + value.toString(16);
  }
  return {
    registers: state.registers,
    activeRegisterId: state.activeRegisterId,
    registerValues: serializedValues,
    theme: state.theme,
    project: state.project,
    sidebarWidth: state.sidebarWidth,
    sidebarCollapsed: state.sidebarCollapsed,
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
    } catch {
      values[id] = 0n;
    }
  }
  return {
    registers,
    activeRegisterId: data.activeRegisterId,
    registerValues: values,
    theme: data.theme,
    project: sanitizeProjectMetadata(data.project),
    sidebarWidth: typeof data.sidebarWidth === 'number'
      ? Math.max(SIDEBAR_WIDTH_MIN, Math.min(SIDEBAR_WIDTH_MAX, data.sidebarWidth))
      : SIDEBAR_WIDTH_DEFAULT,
    sidebarCollapsed: data.sidebarCollapsed === true,
    mapTableWidth: (MAP_TABLE_WIDTH_VALUES as readonly number[]).includes(data.mapTableWidth as number)
      ? data.mapTableWidth as MapTableWidth : 32,
    mapShowGaps: data.mapShowGaps !== false,
    mapSortDescending: data.mapSortDescending === true,
    addressUnitBits: typeof data.addressUnitBits === 'number' && (ADDRESS_UNIT_BITS_VALUES as readonly number[]).includes(data.addressUnitBits)
      ? data.addressUnitBits as AddressUnitBits : ADDRESS_UNIT_BITS_DEFAULT,
  };
}

export function saveToLocalStorage(state: AppState): void {
  try {
    const serialized = serializeState(state);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
  } catch {
    // Silently fail if localStorage is full or unavailable
  }
}

export function loadFromLocalStorage(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SerializedAppState;
    return deserializeState(parsed);
  } catch {
    return null;
  }
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
  if (typeof obj.date === 'string' && obj.date.trim()) result.date = obj.date.trim();
  if (typeof obj.authorEmail === 'string' && obj.authorEmail.trim()) result.authorEmail = obj.authorEmail.trim();
  if (typeof obj.link === 'string' && obj.link.trim()) result.link = obj.link.trim();
  return Object.keys(result).length > 0 ? result : undefined;
}

export function exportToJson(state: AppState, pretty = false): string {
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

export function importFromJson(json: string): ImportResult | null {
  try {
    const data = JSON.parse(json);
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
      for (const [key, hex] of Object.entries(data.registerValues)) {
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
            values[resolvedId] = BigInt(hex as string);
          } catch {
            values[resolvedId] = 0n;
          }
        }
      }
    }
    const project = sanitizeProjectMetadata(data.project);
    const addressUnitBits: AddressUnitBits | undefined = typeof data.addressUnitBits === 'number' && (ADDRESS_UNIT_BITS_VALUES as readonly number[]).includes(data.addressUnitBits)
      ? data.addressUnitBits as AddressUnitBits : undefined;
    return { registers: validRegisters, values, warnings, project, addressUnitBits };
  } catch {
    return null;
  }
}
