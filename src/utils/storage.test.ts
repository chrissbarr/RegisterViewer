import {
  serializeState,
  deserializeState,
  saveToLocalStorage,
  loadFromLocalStorage,
  exportToJson,
  importFromJson,
} from './storage';
import { makeState, makeRegister, makeField } from '../test/helpers';

describe('serializeState', () => {
  it('converts bigint values to hex strings with 0x prefix', () => {
    const state = makeState({ registerValues: { 'reg-1': 0xABCDn } });
    const serialized = serializeState(state);
    expect(serialized.registerValues['reg-1']).toBe('0xabcd');
  });

  it('converts zero to "0x0"', () => {
    const state = makeState({ registerValues: { 'reg-1': 0n } });
    const serialized = serializeState(state);
    expect(serialized.registerValues['reg-1']).toBe('0x0');
  });

  it('correctly serializes a 64-bit value', () => {
    const state = makeState({ registerValues: { 'reg-1': 0xDEADBEEFCAFEBABEn } });
    const serialized = serializeState(state);
    expect(serialized.registerValues['reg-1']).toBe('0xdeadbeefcafebabe');
  });
});

describe('deserializeState', () => {
  it('converts hex strings back to bigint', () => {
    const serialized = {
      registers: [],
      activeRegisterId: null,
      registerValues: { 'reg-1': '0xabcd' },
      theme: 'dark' as const,
      sidebarWidth: 224,
      sidebarCollapsed: false,
    };
    const state = deserializeState(serialized);
    expect(state.registerValues['reg-1']).toBe(0xABCDn);
  });

  it('falls back to 0n for invalid hex', () => {
    const serialized = {
      registers: [],
      activeRegisterId: null,
      registerValues: { 'reg-1': 'not-a-hex' },
      theme: 'dark' as const,
      sidebarWidth: 224,
      sidebarCollapsed: false,
    };
    const state = deserializeState(serialized);
    expect(state.registerValues['reg-1']).toBe(0n);
  });

  it('clamps register width to 128 when exceeding maximum', () => {
    const serialized = {
      registers: [{ id: 'reg-1', name: 'WIDE', width: 256, fields: [] }],
      activeRegisterId: 'reg-1',
      registerValues: { 'reg-1': '0xFFFF' },
      theme: 'dark' as const,
      sidebarWidth: 224,
      sidebarCollapsed: false,
    };
    const state = deserializeState(serialized);
    expect(state.registers[0].width).toBe(128);
  });

  it('masks register value to clamped width', () => {
    const serialized = {
      registers: [{ id: 'reg-1', name: 'WIDE', width: 256, fields: [] }],
      activeRegisterId: 'reg-1',
      // Value with more than 128 bits set
      registerValues: { 'reg-1': '0x' + 'FF'.repeat(32) },
      theme: 'dark' as const,
      sidebarWidth: 224,
      sidebarCollapsed: false,
    };
    const state = deserializeState(serialized);
    expect(state.registers[0].width).toBe(128);
    // Value should be masked to 128 bits
    const maxVal = (1n << 128n) - 1n;
    expect(state.registerValues['reg-1']).toBe(maxVal);
  });

  it('defaults mapTableWidth to 32 and mapShowGaps to true for legacy data', () => {
    const serialized = {
      registers: [],
      activeRegisterId: null,
      registerValues: {},
      theme: 'dark' as const,
      sidebarWidth: 224,
      sidebarCollapsed: false,
    };
    const state = deserializeState(serialized);
    expect(state.mapTableWidth).toBe(32);
    expect(state.mapShowGaps).toBe(true);
  });

  it('falls back to 32 for invalid mapTableWidth', () => {
    const serialized = {
      registers: [],
      activeRegisterId: null,
      registerValues: {},
      theme: 'dark' as const,
      sidebarWidth: 224,
      sidebarCollapsed: false,
      mapTableWidth: 64 as never,
      mapShowGaps: true,
    };
    const state = deserializeState(serialized);
    expect(state.mapTableWidth).toBe(32);
  });

  it('preserves mapShowGaps false', () => {
    const serialized = {
      registers: [],
      activeRegisterId: null,
      registerValues: {},
      theme: 'dark' as const,
      sidebarWidth: 224,
      sidebarCollapsed: false,
      mapTableWidth: 16 as const,
      mapShowGaps: false,
    };
    const state = deserializeState(serialized);
    expect(state.mapTableWidth).toBe(16);
    expect(state.mapShowGaps).toBe(false);
  });
});

describe('save/loadFromLocalStorage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips state through localStorage', () => {
    const reg = makeRegister({ id: 'reg-1', name: 'TEST' });
    const state = makeState({
      registers: [reg],
      activeRegisterId: 'reg-1',
      registerValues: { 'reg-1': 0x1234n },
      theme: 'light',
    });
    saveToLocalStorage(state);
    const loaded = loadFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded!.registerValues['reg-1']).toBe(0x1234n);
    expect(loaded!.theme).toBe('light');
    expect(loaded!.activeRegisterId).toBe('reg-1');
  });

  it('round-trips map view settings through localStorage', () => {
    const state = makeState({
      mapTableWidth: 8,
      mapShowGaps: false,
    });
    saveToLocalStorage(state);
    const loaded = loadFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded!.mapTableWidth).toBe(8);
    expect(loaded!.mapShowGaps).toBe(false);
  });

  it('returns null when storage is empty', () => {
    expect(loadFromLocalStorage()).toBeNull();
  });

  it('returns null for corrupted JSON', () => {
    localStorage.setItem('register-viewer-state', '{invalid json!!!');
    expect(loadFromLocalStorage()).toBeNull();
  });
});

describe('offset round-trip', () => {
  it('preserves offset through export/import', () => {
    const reg = makeRegister({ id: 'reg-1', name: 'STATUS', offset: 0x04 });
    const state = makeState({
      registers: [reg],
      registerValues: { 'reg-1': 0n },
    });
    const json = exportToJson(state);
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers[0].offset).toBe(0x04);
  });

  it('preserves undefined offset through export/import', () => {
    const reg = makeRegister({ id: 'reg-1', name: 'STATUS' }); // no offset
    const state = makeState({
      registers: [reg],
      registerValues: { 'reg-1': 0n },
    });
    const json = exportToJson(state);
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers[0].offset).toBeUndefined();
  });

  it('preserves offset through localStorage round-trip', () => {
    localStorage.clear();
    const reg = makeRegister({ id: 'reg-1', name: 'STATUS', offset: 0xFF });
    const state = makeState({
      registers: [reg],
      activeRegisterId: 'reg-1',
      registerValues: { 'reg-1': 0n },
    });
    saveToLocalStorage(state);
    const loaded = loadFromLocalStorage();
    expect(loaded).not.toBeNull();
    expect(loaded!.registers[0].offset).toBe(0xFF);
  });
});

describe('exportToJson', () => {
  it('includes version 1 property', () => {
    const state = makeState({ registers: [] });
    const json = exportToJson(state);
    const data = JSON.parse(json);
    expect(data.version).toBe(1);
  });

  it('strips register IDs', () => {
    const reg = makeRegister({ id: 'reg-1', name: 'MY_REG', fields: [] });
    const state = makeState({ registers: [reg] });
    const json = exportToJson(state);
    const data = JSON.parse(json);
    expect(data.registers[0].id).toBeUndefined();
  });

  it('strips field IDs', () => {
    const field = makeField({ id: 'field-1', name: 'MY_FIELD' });
    const reg = makeRegister({ id: 'reg-1', name: 'MY_REG', fields: [field] });
    const state = makeState({ registers: [reg] });
    const json = exportToJson(state);
    const data = JSON.parse(json);
    expect(data.registers[0].fields[0].id).toBeUndefined();
  });

  it('keys values by register name', () => {
    const reg = makeRegister({ id: 'reg-1', name: 'STATUS' });
    const state = makeState({
      registers: [reg],
      registerValues: { 'reg-1': 0xFFn },
    });
    const json = exportToJson(state);
    const data = JSON.parse(json);
    expect(data.registerValues['STATUS']).toBeDefined();
    expect(data.registerValues['reg-1']).toBeUndefined();
  });

  it('stores values as hex strings', () => {
    const reg = makeRegister({ id: 'reg-1', name: 'STATUS' });
    const state = makeState({
      registers: [reg],
      registerValues: { 'reg-1': 0xDEADn },
    });
    const json = exportToJson(state);
    const data = JSON.parse(json);
    expect(data.registerValues['STATUS']).toBe('0xdead');
  });
});

describe('importFromJson', () => {
  it('imports valid JSON with name-based values', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'STATUS', width: 32, fields: [] }],
      registerValues: { STATUS: '0xFF' },
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers).toHaveLength(1);
    expect(result!.registers[0].name).toBe('STATUS');
    expect(result!.warnings).toEqual([]);
    // The value should be resolved by name to the generated register ID
    const regId = result!.registers[0].id;
    expect(result!.values[regId]).toBe(0xFFn);
  });

  it('generates non-empty string IDs for registers without IDs', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'REG', width: 8, fields: [] }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toEqual([]);
    expect(typeof result!.registers[0].id).toBe('string');
    expect(result!.registers[0].id.length).toBeGreaterThan(0);
  });

  it('generates non-empty string IDs for fields without IDs', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{
        name: 'REG',
        width: 8,
        fields: [{ name: 'F', msb: 7, lsb: 0, type: 'integer' }],
      }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toEqual([]);
    expect(typeof result!.registers[0].fields[0].id).toBe('string');
    expect(result!.registers[0].fields[0].id.length).toBeGreaterThan(0);
  });

  it('returns null for invalid JSON', () => {
    expect(importFromJson('not valid json!!!')).toBeNull();
  });

  it('returns null for missing registers array', () => {
    const json = JSON.stringify({ version: 1 });
    expect(importFromJson(json)).toBeNull();
  });

  it('resolves UUID-keyed registerValues by matching register id', () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const json = JSON.stringify({
      version: 1,
      registers: [{ id: uuid, name: 'STATUS', width: 32, fields: [] }],
      registerValues: { [uuid]: '0xBEEF' },
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toEqual([]);
    expect(result!.values[uuid]).toBe(0xBEEFn);
  });

  it('handles registers with no fields property (fields defaults to [])', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'REG', width: 8 }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toEqual([]);
    expect(result!.registers[0].fields).toEqual([]);
  });

  it('ignores registerValues keys that match neither UUID nor register name', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'REG', width: 8, fields: [] }],
      registerValues: { NONEXISTENT: '0xFF' },
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toEqual([]);
    expect(Object.keys(result!.values)).toHaveLength(0);
  });

  it('falls back to 0n for invalid hex value', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'REG', width: 8, fields: [] }],
      registerValues: { REG: 'not-hex' },
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toEqual([]);
    const regId = result!.registers[0].id;
    expect(result!.values[regId]).toBe(0n);
  });

  it('rejects register with width 0', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'INVALID', width: 0, fields: [] }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers).toHaveLength(0);
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0].registerName).toBe('INVALID');
    expect(result!.warnings[0].errors[0].message).toContain('width must be between 1 and 128');
  });

  it('rejects register with width > 128', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'TOO_WIDE', width: 1000, fields: [] }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers).toHaveLength(0);
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0].registerName).toBe('TOO_WIDE');
    expect(result!.warnings[0].errors[0].message).toContain('width must be between 1 and 128');
  });

  it('skips invalid register but keeps valid ones', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [
        { name: 'VALID1', width: 8, fields: [] },
        { name: 'INVALID', width: 0, fields: [] },
        { name: 'VALID2', width: 16, fields: [] },
      ],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers).toHaveLength(2);
    expect(result!.registers[0].name).toBe('VALID1');
    expect(result!.registers[1].name).toBe('VALID2');
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0].registerName).toBe('INVALID');
  });

  it('strips unknown properties from imported registers', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{
        name: 'STATUS',
        width: 8,
        fields: [],
        evilProperty: 'payload',
        hacked: 'another bad prop',
      }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toEqual([]);
    expect(result!.registers).toHaveLength(1);
    expect('evilProperty' in result!.registers[0]).toBe(false);
    expect('hacked' in result!.registers[0]).toBe(false);
    // Verify only expected properties are present
    const reg = result!.registers[0];
    const keys = Object.keys(reg);
    expect(keys.sort()).toEqual(['fields', 'id', 'name', 'width'].sort());
  });

  it('imports register with overlapping fields (overlap is a warning, not an error)', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{
        name: 'STATUS',
        width: 8,
        fields: [
          { name: 'F1', msb: 7, lsb: 4, type: 'integer' },
          { name: 'F2', msb: 5, lsb: 0, type: 'integer' },
        ],
      }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers).toHaveLength(1);
    expect(result!.warnings).toHaveLength(0);
  });

  it('returns warnings with register name and errors', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [
        { name: 'BAD_REG', width: 999, fields: [] },
      ],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0]).toMatchObject({
      registerIndex: 0,
      registerName: 'BAD_REG',
    });
    expect(result!.warnings[0].errors).toBeDefined();
    expect(result!.warnings[0].errors.length).toBeGreaterThan(0);
  });

  it('rejects register with NaN width', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'BAD', width: NaN, fields: [] }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers).toHaveLength(0);
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0].errors[0].message).toContain('width must be between 1 and 128');
  });

  it('rejects register with fractional width', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'BAD', width: 8.5, fields: [] }],
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    expect(result!.registers).toHaveLength(0);
    expect(result!.warnings).toHaveLength(1);
    expect(result!.warnings[0].errors[0].message).toContain('width must be between 1 and 128');
  });
});
