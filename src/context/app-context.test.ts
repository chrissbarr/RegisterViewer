import { appReducer } from './app-context';
import { makeState, makeRegister, makeField } from '../test/helpers';

describe('SET_REGISTER_VALUE', () => {
  it('sets value for the given registerId', () => {
    const state = makeState({ registerValues: {} });
    const next = appReducer(state, {
      type: 'SET_REGISTER_VALUE',
      registerId: 'reg-1',
      value: 0xFFn,
    });
    expect(next.registerValues['reg-1']).toBe(0xFFn);
  });

  it('does not modify other register values', () => {
    const state = makeState({ registerValues: { 'reg-1': 0xAAn, 'reg-2': 0xBBn } });
    const next = appReducer(state, {
      type: 'SET_REGISTER_VALUE',
      registerId: 'reg-1',
      value: 0xCCn,
    });
    expect(next.registerValues['reg-1']).toBe(0xCCn);
    expect(next.registerValues['reg-2']).toBe(0xBBn);
  });
});

describe('TOGGLE_BIT', () => {
  it('toggles bit 0 from 0 to 1', () => {
    const state = makeState({ registerValues: { 'reg-1': 0n } });
    const next = appReducer(state, { type: 'TOGGLE_BIT', registerId: 'reg-1', bit: 0 });
    expect(next.registerValues['reg-1']).toBe(1n);
  });

  it('toggles bit 0 from 1 to 0', () => {
    const state = makeState({ registerValues: { 'reg-1': 1n } });
    const next = appReducer(state, { type: 'TOGGLE_BIT', registerId: 'reg-1', bit: 0 });
    expect(next.registerValues['reg-1']).toBe(0n);
  });

  it('defaults to 0n for a missing register', () => {
    const state = makeState({ registerValues: {} });
    const next = appReducer(state, { type: 'TOGGLE_BIT', registerId: 'reg-1', bit: 3 });
    // 0n ^ (1n << 3n) = 8n
    expect(next.registerValues['reg-1']).toBe(8n);
  });
});

describe('SET_FIELD_VALUE', () => {
  it('replaces bits [7:4] correctly', () => {
    const field = makeField({ msb: 7, lsb: 4 });
    const state = makeState({ registerValues: { 'reg-1': 0x00n } });
    const next = appReducer(state, {
      type: 'SET_FIELD_VALUE',
      registerId: 'reg-1',
      field,
      rawBits: 0xAn,
    });
    expect(next.registerValues['reg-1']).toBe(0xA0n);
  });

  it('preserves other bits when setting a field', () => {
    const field = makeField({ msb: 7, lsb: 4 });
    const state = makeState({ registerValues: { 'reg-1': 0x0Fn } });
    const next = appReducer(state, {
      type: 'SET_FIELD_VALUE',
      registerId: 'reg-1',
      field,
      rawBits: 0x5n,
    });
    expect(next.registerValues['reg-1']).toBe(0x5Fn);
  });

  it('defaults to 0n for an uninitialized register', () => {
    const field = makeField({ msb: 3, lsb: 0 });
    const state = makeState({ registerValues: {} });
    const next = appReducer(state, {
      type: 'SET_FIELD_VALUE',
      registerId: 'reg-1',
      field,
      rawBits: 0xCn,
    });
    expect(next.registerValues['reg-1']).toBe(0xCn);
  });
});

describe('ADD_REGISTER', () => {
  it('appends the register to the list', () => {
    const reg = makeRegister({ id: 'reg-new', name: 'NEW' });
    const state = makeState({ registers: [makeRegister()] });
    const next = appReducer(state, { type: 'ADD_REGISTER', register: reg });
    expect(next.registers).toHaveLength(2);
    expect(next.registers[1].id).toBe('reg-new');
  });

  it('sets activeRegisterId to the new register', () => {
    const reg = makeRegister({ id: 'reg-new' });
    const state = makeState();
    const next = appReducer(state, { type: 'ADD_REGISTER', register: reg });
    expect(next.activeRegisterId).toBe('reg-new');
  });

  it('initializes the register value to 0n', () => {
    const reg = makeRegister({ id: 'reg-new' });
    const state = makeState();
    const next = appReducer(state, { type: 'ADD_REGISTER', register: reg });
    expect(next.registerValues['reg-new']).toBe(0n);
  });
});

describe('UPDATE_REGISTER', () => {
  it('updates the matching register', () => {
    const original = makeRegister({ id: 'reg-1', name: 'OLD' });
    const updated = makeRegister({ id: 'reg-1', name: 'UPDATED' });
    const state = makeState({ registers: [original] });
    const next = appReducer(state, { type: 'UPDATE_REGISTER', register: updated });
    expect(next.registers[0].name).toBe('UPDATED');
  });

  it('leaves other registers unchanged', () => {
    const r1 = makeRegister({ id: 'reg-1', name: 'A' });
    const r2 = makeRegister({ id: 'reg-2', name: 'B' });
    const state = makeState({ registers: [r1, r2] });
    const next = appReducer(state, {
      type: 'UPDATE_REGISTER',
      register: makeRegister({ id: 'reg-1', name: 'A2' }),
    });
    expect(next.registers[0].name).toBe('A2');
    expect(next.registers[1].name).toBe('B');
  });
});

describe('DELETE_REGISTER', () => {
  it('removes the register from the list', () => {
    const state = makeState({
      registers: [makeRegister({ id: 'reg-1' }), makeRegister({ id: 'reg-2' })],
      registerValues: { 'reg-1': 1n, 'reg-2': 2n },
    });
    const next = appReducer(state, { type: 'DELETE_REGISTER', registerId: 'reg-1' });
    expect(next.registers).toHaveLength(1);
    expect(next.registers[0].id).toBe('reg-2');
  });

  it('removes the register value', () => {
    const state = makeState({
      registers: [makeRegister({ id: 'reg-1' })],
      registerValues: { 'reg-1': 42n },
    });
    const next = appReducer(state, { type: 'DELETE_REGISTER', registerId: 'reg-1' });
    expect(next.registerValues['reg-1']).toBeUndefined();
  });

  it('updates activeRegisterId to first remaining if deleted was active', () => {
    const state = makeState({
      registers: [makeRegister({ id: 'reg-1' }), makeRegister({ id: 'reg-2' })],
      activeRegisterId: 'reg-1',
      registerValues: { 'reg-1': 0n, 'reg-2': 0n },
    });
    const next = appReducer(state, { type: 'DELETE_REGISTER', registerId: 'reg-1' });
    expect(next.activeRegisterId).toBe('reg-2');
  });

  it('sets activeRegisterId to null if no registers remain', () => {
    const state = makeState({
      registers: [makeRegister({ id: 'reg-1' })],
      activeRegisterId: 'reg-1',
      registerValues: { 'reg-1': 0n },
    });
    const next = appReducer(state, { type: 'DELETE_REGISTER', registerId: 'reg-1' });
    expect(next.activeRegisterId).toBeNull();
  });
});

describe('SET_ACTIVE_REGISTER', () => {
  it('sets the activeRegisterId', () => {
    const state = makeState({ activeRegisterId: 'reg-1' });
    const next = appReducer(state, { type: 'SET_ACTIVE_REGISTER', registerId: 'reg-2' });
    expect(next.activeRegisterId).toBe('reg-2');
  });
});

describe('TOGGLE_THEME', () => {
  it('toggles dark to light', () => {
    const state = makeState({ theme: 'dark' });
    const next = appReducer(state, { type: 'TOGGLE_THEME' });
    expect(next.theme).toBe('light');
  });

  it('toggles light to dark', () => {
    const state = makeState({ theme: 'light' });
    const next = appReducer(state, { type: 'TOGGLE_THEME' });
    expect(next.theme).toBe('dark');
  });
});

describe('IMPORT_STATE', () => {
  it('replaces all registers', () => {
    const r1 = makeRegister({ id: 'reg-old' });
    const r2 = makeRegister({ id: 'reg-new', name: 'NEW' });
    const state = makeState({ registers: [r1], registerValues: { 'reg-old': 5n } });
    const next = appReducer(state, { type: 'IMPORT_STATE', registers: [r2], values: {} });
    expect(next.registers).toHaveLength(1);
    expect(next.registers[0].id).toBe('reg-new');
  });

  it('atomically sets registers and values in a single dispatch', () => {
    const r1 = makeRegister({ id: 'reg-a' });
    const r2 = makeRegister({ id: 'reg-b' });
    const state = makeState();
    const next = appReducer(state, {
      type: 'IMPORT_STATE',
      registers: [r1, r2],
      values: { 'reg-a': 0xAAn, 'reg-b': 0xBBn },
    });
    expect(next.registers).toHaveLength(2);
    expect(next.registerValues['reg-a']).toBe(0xAAn);
    expect(next.registerValues['reg-b']).toBe(0xBBn);
  });

  it('defaults to 0n for registers without a provided value', () => {
    const reg = makeRegister({ id: 'reg-1' });
    const state = makeState();
    const next = appReducer(state, { type: 'IMPORT_STATE', registers: [reg], values: {} });
    expect(next.registerValues['reg-1']).toBe(0n);
  });

  it('ignores values for registers not in the imported list', () => {
    const reg = makeRegister({ id: 'reg-1' });
    const state = makeState();
    const next = appReducer(state, {
      type: 'IMPORT_STATE',
      registers: [reg],
      values: { 'reg-1': 0xAAn, 'reg-orphan': 0xFFn },
    });
    expect(next.registerValues['reg-1']).toBe(0xAAn);
    expect(next.registerValues['reg-orphan']).toBeUndefined();
  });

  it('sets activeRegisterId to first imported register', () => {
    const r1 = makeRegister({ id: 'reg-a' });
    const r2 = makeRegister({ id: 'reg-b' });
    const state = makeState();
    const next = appReducer(state, { type: 'IMPORT_STATE', registers: [r1, r2], values: {} });
    expect(next.activeRegisterId).toBe('reg-a');
  });

  it('sets activeRegisterId to null when importing empty array', () => {
    const state = makeState({ activeRegisterId: 'reg-1' });
    const next = appReducer(state, { type: 'IMPORT_STATE', registers: [], values: {} });
    expect(next.activeRegisterId).toBeNull();
  });

  it('preserves theme from existing state', () => {
    const reg = makeRegister({ id: 'reg-1' });
    const state = makeState({ theme: 'light' });
    const next = appReducer(state, { type: 'IMPORT_STATE', registers: [reg], values: {} });
    expect(next.theme).toBe('light');
  });
});

describe('LOAD_STATE', () => {
  it('completely replaces the state', () => {
    const original = makeState({ theme: 'dark', activeRegisterId: 'old' });
    const replacement = makeState({
      theme: 'light',
      activeRegisterId: 'new',
      registers: [makeRegister({ id: 'new' })],
      registerValues: { 'new': 99n },
    });
    const next = appReducer(original, { type: 'LOAD_STATE', state: replacement });
    expect(next).toEqual(replacement);
  });
});

describe('SORT_REGISTERS_BY_OFFSET', () => {
  it('sorts registers ascending by offset', () => {
    const r1 = makeRegister({ id: 'reg-1', name: 'A', offset: 0x08 });
    const r2 = makeRegister({ id: 'reg-2', name: 'B', offset: 0x00 });
    const r3 = makeRegister({ id: 'reg-3', name: 'C', offset: 0x04 });
    const state = makeState({ registers: [r1, r2, r3] });
    const next = appReducer(state, { type: 'SORT_REGISTERS_BY_OFFSET' });
    expect(next.registers.map((r) => r.id)).toEqual(['reg-2', 'reg-3', 'reg-1']);
  });

  it('puts registers without offset at the end', () => {
    const r1 = makeRegister({ id: 'reg-1', name: 'A' }); // no offset
    const r2 = makeRegister({ id: 'reg-2', name: 'B', offset: 0x04 });
    const r3 = makeRegister({ id: 'reg-3', name: 'C', offset: 0x00 });
    const state = makeState({ registers: [r1, r2, r3] });
    const next = appReducer(state, { type: 'SORT_REGISTERS_BY_OFFSET' });
    expect(next.registers.map((r) => r.id)).toEqual(['reg-3', 'reg-2', 'reg-1']);
  });

  it('preserves relative order of registers without offset', () => {
    const r1 = makeRegister({ id: 'reg-1', name: 'A' }); // no offset
    const r2 = makeRegister({ id: 'reg-2', name: 'B' }); // no offset
    const r3 = makeRegister({ id: 'reg-3', name: 'C', offset: 0x00 });
    const state = makeState({ registers: [r1, r2, r3] });
    const next = appReducer(state, { type: 'SORT_REGISTERS_BY_OFFSET' });
    expect(next.registers.map((r) => r.id)).toEqual(['reg-3', 'reg-1', 'reg-2']);
  });

  it('does not mutate the original state', () => {
    const r1 = makeRegister({ id: 'reg-1', offset: 0x08 });
    const r2 = makeRegister({ id: 'reg-2', offset: 0x00 });
    const state = makeState({ registers: [r1, r2] });
    const next = appReducer(state, { type: 'SORT_REGISTERS_BY_OFFSET' });
    expect(state.registers[0].id).toBe('reg-1');
    expect(next.registers[0].id).toBe('reg-2');
  });
});

describe('default case', () => {
  it('returns state unchanged for an unknown action type', () => {
    const state = makeState({ theme: 'dark' });
    const next = appReducer(state, { type: 'UNKNOWN_ACTION' } as never);
    expect(next).toBe(state);
  });
});
