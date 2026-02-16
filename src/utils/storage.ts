import type { AppState, RegisterDef, SerializedAppState } from '../types/register';
import { sanitizeRegisterDef } from './sanitize';
import { validateRegisterDef, type ValidationError } from './validation';

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
  };
}

export function deserializeState(data: SerializedAppState): AppState {
  const values: Record<string, bigint> = {};
  for (const [id, hex] of Object.entries(data.registerValues)) {
    try {
      values[id] = BigInt(hex);
    } catch {
      values[id] = 0n;
    }
  }
  return {
    registers: data.registers,
    activeRegisterId: data.activeRegisterId,
    registerValues: values,
    theme: data.theme,
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

type ExportField = Omit<RegisterDef['fields'][number], 'id'>;
type ExportRegister = Omit<RegisterDef, 'id' | 'fields'> & { fields: ExportField[] };

function stripIds(register: RegisterDef): ExportRegister {
  const { id: _regId, fields, ...rest } = register;
  void _regId;
  const cleanFields: ExportField[] = fields.map(({ id: _fieldId, ...fieldRest }) => {
    void _fieldId;
    return fieldRest;
  });
  return { ...rest, fields: cleanFields };
}

export function exportToJson(state: AppState): string {
  const cleanRegisters = state.registers.map(stripIds);
  const registerValues: Record<string, string> = {};
  for (const reg of state.registers) {
    const value = state.registerValues[reg.id];
    if (value !== undefined) {
      registerValues[reg.name] = '0x' + value.toString(16);
    }
  }
  const data = {
    version: 1,
    registers: cleanRegisters,
    registerValues,
  };
  return JSON.stringify(data, null, 2);
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
    return { registers: validRegisters, values, warnings };
  } catch {
    return null;
  }
}
