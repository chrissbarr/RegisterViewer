import type { RegisterDef, Field } from '../types/register';
import { registersEqual } from './register-equality';

function makeReg(overrides?: Partial<RegisterDef>): RegisterDef {
  return {
    id: 'reg-1',
    name: 'STATUS',
    width: 8,
    fields: [],
    ...overrides,
  };
}

function makeField(overrides?: Partial<Field>): Field {
  return {
    id: 'f1',
    name: 'ENABLE',
    type: 'flag',
    msb: 0,
    lsb: 0,
    ...overrides,
  } as Field;
}

// ---------------------------------------------------------------------------
// Identical registers
// ---------------------------------------------------------------------------
describe('registersEqual — identical registers', () => {
  it('returns true for identical empty-field registers', () => {
    expect(registersEqual(makeReg(), makeReg())).toBe(true);
  });

  it('returns true for registers with identical fields', () => {
    const fields: Field[] = [
      { id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0 },
      { id: 'f2', name: 'MODE', type: 'enum', msb: 3, lsb: 1, enumEntries: [{ value: 0, name: 'OFF' }, { value: 1, name: 'ON' }] },
    ];
    expect(registersEqual(makeReg({ fields }), makeReg({ fields }))).toBe(true);
  });

  it('returns true with optional properties both present', () => {
    const a = makeReg({ description: 'desc', offset: 0x10 });
    const b = makeReg({ description: 'desc', offset: 0x10 });
    expect(registersEqual(a, b)).toBe(true);
  });

  it('returns true with optional properties both absent', () => {
    const a = makeReg();
    const b = makeReg();
    expect(registersEqual(a, b)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Top-level differences
// ---------------------------------------------------------------------------
describe('registersEqual — top-level differences', () => {
  it('detects different id', () => {
    expect(registersEqual(makeReg({ id: 'a' }), makeReg({ id: 'b' }))).toBe(false);
  });

  it('detects different name', () => {
    expect(registersEqual(makeReg({ name: 'A' }), makeReg({ name: 'B' }))).toBe(false);
  });

  it('detects different width', () => {
    expect(registersEqual(makeReg({ width: 8 }), makeReg({ width: 16 }))).toBe(false);
  });

  it('detects different description', () => {
    expect(registersEqual(makeReg({ description: 'x' }), makeReg({ description: 'y' }))).toBe(false);
  });

  it('detects description present vs absent', () => {
    expect(registersEqual(makeReg({ description: 'x' }), makeReg())).toBe(false);
  });

  it('detects different offset', () => {
    expect(registersEqual(makeReg({ offset: 0 }), makeReg({ offset: 1 }))).toBe(false);
  });

  it('detects offset present vs absent', () => {
    expect(registersEqual(makeReg({ offset: 0 }), makeReg())).toBe(false);
  });

  it('detects different field count', () => {
    expect(registersEqual(
      makeReg({ fields: [makeField()] }),
      makeReg({ fields: [] }),
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field-level: base properties
// ---------------------------------------------------------------------------
describe('registersEqual — field base properties', () => {
  it('detects different field id', () => {
    expect(registersEqual(
      makeReg({ fields: [makeField({ id: 'a' })] }),
      makeReg({ fields: [makeField({ id: 'b' })] }),
    )).toBe(false);
  });

  it('detects different field name', () => {
    expect(registersEqual(
      makeReg({ fields: [makeField({ name: 'A' })] }),
      makeReg({ fields: [makeField({ name: 'B' })] }),
    )).toBe(false);
  });

  it('detects different msb', () => {
    expect(registersEqual(
      makeReg({ fields: [makeField({ msb: 7 })] }),
      makeReg({ fields: [makeField({ msb: 6 })] }),
    )).toBe(false);
  });

  it('detects different lsb', () => {
    expect(registersEqual(
      makeReg({ fields: [makeField({ lsb: 0 })] }),
      makeReg({ fields: [makeField({ lsb: 1 })] }),
    )).toBe(false);
  });

  it('detects different field type', () => {
    expect(registersEqual(
      makeReg({ fields: [makeField({ type: 'flag' })] }),
      makeReg({ fields: [{ id: 'f1', name: 'ENABLE', type: 'integer', msb: 0, lsb: 0 }] }),
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field-level: flag
// ---------------------------------------------------------------------------
describe('registersEqual — flag fields', () => {
  it('equal when both have no flagLabels', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0 }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0 }] });
    expect(registersEqual(a, b)).toBe(true);
  });

  it('equal when both have identical flagLabels', () => {
    const labels = { clear: 'Off', set: 'On' };
    const a = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0, flagLabels: labels }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0, flagLabels: { ...labels } }] });
    expect(registersEqual(a, b)).toBe(true);
  });

  it('detects different flagLabels', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0, flagLabels: { clear: 'Off', set: 'On' } }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0, flagLabels: { clear: 'Disabled', set: 'Enabled' } }] });
    expect(registersEqual(a, b)).toBe(false);
  });

  it('detects flagLabels present vs absent', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0, flagLabels: { clear: 'Off', set: 'On' } }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0 }] });
    expect(registersEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field-level: enum
// ---------------------------------------------------------------------------
describe('registersEqual — enum fields', () => {
  it('equal with identical enumEntries', () => {
    const entries = [{ value: 0, name: 'OFF' }, { value: 1, name: 'ON' }];
    const a = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: entries }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: [...entries] }] });
    expect(registersEqual(a, b)).toBe(true);
  });

  it('detects different enum entry count', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: [{ value: 0, name: 'A' }] }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: [] }] });
    expect(registersEqual(a, b)).toBe(false);
  });

  it('detects different enum entry value', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: [{ value: 0, name: 'A' }] }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: [{ value: 1, name: 'A' }] }] });
    expect(registersEqual(a, b)).toBe(false);
  });

  it('detects different enum entry name', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: [{ value: 0, name: 'A' }] }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'M', type: 'enum', msb: 1, lsb: 0, enumEntries: [{ value: 0, name: 'B' }] }] });
    expect(registersEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field-level: integer
// ---------------------------------------------------------------------------
describe('registersEqual — integer fields', () => {
  it('equal with same signedness', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0, signedness: 'twos-complement' }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0, signedness: 'twos-complement' }] });
    expect(registersEqual(a, b)).toBe(true);
  });

  it('detects different signedness', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0, signedness: 'twos-complement' }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0, signedness: 'sign-magnitude' }] });
    expect(registersEqual(a, b)).toBe(false);
  });

  it('detects signedness present vs absent', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0, signedness: 'twos-complement' }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0 }] });
    expect(registersEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field-level: float
// ---------------------------------------------------------------------------
describe('registersEqual — float fields', () => {
  it('equal with same floatType', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'F', type: 'float', msb: 15, lsb: 0, floatType: 'half' }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'F', type: 'float', msb: 15, lsb: 0, floatType: 'half' }] });
    expect(registersEqual(a, b)).toBe(true);
  });

  it('detects different floatType', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'F', type: 'float', msb: 31, lsb: 0, floatType: 'single' }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'F', type: 'float', msb: 31, lsb: 0, floatType: 'double' }] });
    expect(registersEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field-level: fixed-point
// ---------------------------------------------------------------------------
describe('registersEqual — fixed-point fields', () => {
  it('equal with same qFormat', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'Q', type: 'fixed-point', msb: 15, lsb: 0, qFormat: { m: 8, n: 8 } }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'Q', type: 'fixed-point', msb: 15, lsb: 0, qFormat: { m: 8, n: 8 } }] });
    expect(registersEqual(a, b)).toBe(true);
  });

  it('detects different qFormat.m', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'Q', type: 'fixed-point', msb: 15, lsb: 0, qFormat: { m: 8, n: 8 } }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'Q', type: 'fixed-point', msb: 15, lsb: 0, qFormat: { m: 7, n: 8 } }] });
    expect(registersEqual(a, b)).toBe(false);
  });

  it('detects different qFormat.n', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'Q', type: 'fixed-point', msb: 15, lsb: 0, qFormat: { m: 8, n: 8 } }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'Q', type: 'fixed-point', msb: 15, lsb: 0, qFormat: { m: 8, n: 7 } }] });
    expect(registersEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Field order sensitivity
// ---------------------------------------------------------------------------
describe('registersEqual — field order', () => {
  it('detects reordered fields as different', () => {
    const f1: Field = { id: 'f1', name: 'A', type: 'flag', msb: 0, lsb: 0 };
    const f2: Field = { id: 'f2', name: 'B', type: 'flag', msb: 1, lsb: 1 };
    expect(registersEqual(
      makeReg({ fields: [f1, f2] }),
      makeReg({ fields: [f2, f1] }),
    )).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: signedness explicit vs undefined
// ---------------------------------------------------------------------------
describe('registersEqual — signedness edge cases', () => {
  it('detects unsigned vs undefined as different', () => {
    const a = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0, signedness: 'unsigned' }] });
    const b = makeReg({ fields: [{ id: 'f1', name: 'V', type: 'integer', msb: 7, lsb: 0 }] });
    expect(registersEqual(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Mixed field types in same register
// ---------------------------------------------------------------------------
describe('registersEqual — complex registers', () => {
  it('handles register with all field types', () => {
    const fields: Field[] = [
      { id: 'f1', name: 'EN', type: 'flag', msb: 0, lsb: 0, flagLabels: { clear: 'Off', set: 'On' } },
      { id: 'f2', name: 'MODE', type: 'enum', msb: 2, lsb: 1, enumEntries: [{ value: 0, name: 'A' }] },
      { id: 'f3', name: 'VAL', type: 'integer', msb: 10, lsb: 3, signedness: 'twos-complement' },
      { id: 'f4', name: 'FLT', type: 'float', msb: 26, lsb: 11, floatType: 'half' },
      { id: 'f5', name: 'FIX', type: 'fixed-point', msb: 31, lsb: 27, qFormat: { m: 3, n: 2 } },
    ];
    const a = makeReg({ width: 32, fields });
    const b = makeReg({ width: 32, fields: fields.map(f => ({ ...f })) });
    expect(registersEqual(a, b)).toBe(true);
  });
});
