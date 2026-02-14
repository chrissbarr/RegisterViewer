import type { Field, RegisterDef, AppState } from '../types/register';

export function makeField(overrides: Partial<Field> = {}): Field {
  return {
    id: 'field-1',
    name: 'TEST_FIELD',
    msb: 7,
    lsb: 0,
    type: 'integer',
    ...overrides,
  };
}

export function makeRegister(overrides: Partial<RegisterDef> = {}): RegisterDef {
  return {
    id: 'reg-1',
    name: 'TEST_REG',
    width: 32,
    fields: [],
    ...overrides,
  };
}

export function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    registers: [],
    activeRegisterId: null,
    registerValues: {},
    theme: 'dark',
    ...overrides,
  };
}
