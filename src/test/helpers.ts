import { SIDEBAR_WIDTH_DEFAULT, ADDRESS_UNIT_BITS_DEFAULT, type IntegerField, type FlagField, type EnumField, type FloatField, type FixedPointField, type RegisterDef, type AppState } from '../types/register';

/** Creates an IntegerField by default. For other types, use the type-specific factories. */
export function makeField(overrides: Partial<IntegerField> = {}): IntegerField {
  return {
    id: 'field-1',
    name: 'TEST_FIELD',
    msb: 7,
    lsb: 0,
    type: 'integer',
    ...overrides,
  };
}

export function makeFlagField(overrides: Partial<FlagField> = {}): FlagField {
  return {
    id: 'field-1',
    name: 'TEST_FLAG',
    msb: 0,
    lsb: 0,
    type: 'flag',
    ...overrides,
  };
}

export function makeEnumField(overrides: Partial<EnumField> = {}): EnumField {
  return {
    id: 'field-1',
    name: 'TEST_ENUM',
    msb: 7,
    lsb: 0,
    type: 'enum',
    enumEntries: [{ value: 0, name: 'A' }, { value: 1, name: 'B' }],
    ...overrides,
  };
}

export function makeFloatField(overrides: Partial<FloatField> = {}): FloatField {
  return {
    id: 'field-1',
    name: 'TEST_FLOAT',
    msb: 31,
    lsb: 0,
    type: 'float',
    floatType: 'single',
    ...overrides,
  };
}

export function makeFixedPointField(overrides: Partial<FixedPointField> = {}): FixedPointField {
  return {
    id: 'field-1',
    name: 'TEST_FIXED',
    msb: 7,
    lsb: 0,
    type: 'fixed-point',
    qFormat: { m: 4, n: 4 },
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
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    sidebarCollapsed: false,
    mapTableWidth: 32,
    mapShowGaps: true,
    addressUnitBits: ADDRESS_UNIT_BITS_DEFAULT,
    ...overrides,
  };
}
