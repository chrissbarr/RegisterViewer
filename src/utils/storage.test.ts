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
    };
    const state = deserializeState(serialized);
    expect(state.registerValues['reg-1']).toBe(0n);
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

  it('returns null when storage is empty', () => {
    expect(loadFromLocalStorage()).toBeNull();
  });

  it('returns null for corrupted JSON', () => {
    localStorage.setItem('register-viewer-state', '{invalid json!!!');
    expect(loadFromLocalStorage()).toBeNull();
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

  it('falls back to 0n for invalid hex value', () => {
    const json = JSON.stringify({
      version: 1,
      registers: [{ name: 'REG', width: 8, fields: [] }],
      registerValues: { REG: 'not-hex' },
    });
    const result = importFromJson(json);
    expect(result).not.toBeNull();
    const regId = result!.registers[0].id;
    expect(result!.values[regId]).toBe(0n);
  });
});
