import type { AppState, SerializedAppState } from '../types/register';

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

export function exportToJson(state: AppState): string {
  const data = {
    version: 1,
    registers: state.registers,
    registerValues: Object.fromEntries(
      Object.entries(state.registerValues).map(([id, v]) => [id, '0x' + v.toString(16)])
    ),
  };
  return JSON.stringify(data, null, 2);
}

export function importFromJson(json: string): { registers: AppState['registers']; values: Record<string, bigint> } | null {
  try {
    const data = JSON.parse(json);
    if (!data.registers || !Array.isArray(data.registers)) return null;
    const values: Record<string, bigint> = {};
    if (data.registerValues) {
      for (const [id, hex] of Object.entries(data.registerValues)) {
        try {
          values[id] = BigInt(hex as string);
        } catch {
          values[id] = 0n;
        }
      }
    }
    return { registers: data.registers, values };
  } catch {
    return null;
  }
}
