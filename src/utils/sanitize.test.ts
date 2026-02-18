import { sanitizeField, sanitizeRegisterDef } from './sanitize';
import type { EnumField, Field, FixedPointField, FlagField, FloatField, IntegerField, RegisterDef } from '../types/register';

describe('sanitizeField', () => {
  it('picks only known properties, strips unknown ones', () => {
    const raw = {
      id: 'field-1',
      name: 'TEST',
      msb: 7,
      lsb: 0,
      type: 'integer',
      __proto_pollution__: true,
      evil: 'payload',
      hacked: { nested: 'object' },
    };
    const field = sanitizeField(raw);
    expect(field).toEqual({
      id: 'field-1',
      name: 'TEST',
      msb: 7,
      lsb: 0,
      type: 'integer',
    });
    expect('evil' in field).toBe(false);
    expect('__proto_pollution__' in field).toBe(false);
  });

  it('assigns UUID when id is missing', () => {
    const field = sanitizeField({ name: 'F', msb: 0, lsb: 0, type: 'flag' });
    expect(typeof field.id).toBe('string');
    expect(field.id.length).toBeGreaterThan(0);
  });

  it('assigns UUID when id is empty string', () => {
    const field = sanitizeField({ id: '', name: 'F', msb: 0, lsb: 0, type: 'flag' });
    expect(typeof field.id).toBe('string');
    expect(field.id.length).toBeGreaterThan(0);
    expect(field.id).not.toBe('');
  });

  it('defaults type to "integer" for unknown type', () => {
    const field = sanitizeField({ name: 'F', msb: 7, lsb: 0, type: 'HACKED' });
    expect(field.type).toBe('integer');
  });

  it('defaults type to "integer" when type is missing', () => {
    const field = sanitizeField({ name: 'F', msb: 7, lsb: 0 });
    expect(field.type).toBe('integer');
  });

  it('preserves valid type values', () => {
    const types: Array<'flag' | 'enum' | 'integer' | 'float' | 'fixed-point'> = [
      'flag', 'enum', 'integer', 'float', 'fixed-point',
    ];
    for (const type of types) {
      const field = sanitizeField({ name: 'F', msb: 0, lsb: 0, type });
      expect(field.type).toBe(type);
    }
  });

  it('preserves description when present', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 0,
      lsb: 0,
      type: 'flag',
      description: 'A test field',
    });
    expect(field.description).toBe('A test field');
  });

  it('omits description when not a string', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 0,
      lsb: 0,
      type: 'flag',
      description: 123,
    });
    expect(field.description).toBeUndefined();
    expect('description' in field).toBe(false);
  });

  it('preserves signedness when valid', () => {
    for (const signedness of ['unsigned', 'twos-complement', 'sign-magnitude'] as const) {
      const field = sanitizeField({
        name: 'F',
        msb: 7,
        lsb: 0,
        type: 'integer',
        signedness,
      }) as IntegerField;
      expect(field.signedness).toBe(signedness);
    }
  });

  it('migrates old signed: true to twos-complement', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 7,
      lsb: 0,
      type: 'integer',
      signed: true,
    }) as IntegerField;
    expect(field.signedness).toBe('twos-complement');
  });

  it('omits signedness when not a valid string', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 7,
      lsb: 0,
      type: 'integer',
      signedness: 'invalid',
    });
    expect('signedness' in field).toBe(false);
  });

  it('omits signedness for old signed: false', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 7,
      lsb: 0,
      type: 'integer',
      signed: false,
    });
    expect('signedness' in field).toBe(false);
  });

  it('preserves enumEntries when valid', () => {
    const field = sanitizeField({
      name: 'MODE',
      msb: 1,
      lsb: 0,
      type: 'enum',
      enumEntries: [
        { value: 0, name: 'OFF' },
        { value: 1, name: 'ON' },
      ],
    }) as EnumField;
    expect(field.enumEntries).toEqual([
      { value: 0, name: 'OFF' },
      { value: 1, name: 'ON' },
    ]);
  });

  it('filters malformed enumEntries', () => {
    const field = sanitizeField({
      name: 'MODE',
      msb: 1,
      lsb: 0,
      type: 'enum',
      enumEntries: [
        { value: 0, name: 'OFF' },
        { value: 'bad', name: 'INVALID' }, // value is not a number
        { value: 2 }, // missing name
        'not an object',
        null,
        { value: 3, name: 'VALID' },
      ],
    }) as EnumField;
    expect(field.enumEntries).toEqual([
      { value: 0, name: 'OFF' },
      { value: 3, name: 'VALID' },
    ]);
  });

  it('defaults enumEntries to empty array when not an array', () => {
    const field = sanitizeField({
      name: 'MODE',
      msb: 1,
      lsb: 0,
      type: 'enum',
      enumEntries: { value: 0, name: 'OFF' },
    }) as EnumField;
    expect(field.enumEntries).toEqual([]);
  });

  it('preserves floatType when valid', () => {
    const validTypes: Array<'half' | 'single' | 'double'> = ['half', 'single', 'double'];
    for (const floatType of validTypes) {
      const field = sanitizeField({
        name: 'F',
        msb: 31,
        lsb: 0,
        type: 'float',
        floatType,
      }) as FloatField;
      expect(field.floatType).toBe(floatType);
    }
  });

  it('defaults floatType to single when invalid', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 31,
      lsb: 0,
      type: 'float',
      floatType: 'quadruple',
    }) as FloatField;
    expect(field.floatType).toBe('single');
  });

  it('preserves qFormat when valid', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 15,
      lsb: 0,
      type: 'fixed-point',
      qFormat: { m: 8, n: 8 },
    }) as FixedPointField;
    expect(field.qFormat).toEqual({ m: 8, n: 8 });
  });

  it('defaults qFormat when not an object', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 15,
      lsb: 0,
      type: 'fixed-point',
      qFormat: 'Q8.8',
    }) as FixedPointField;
    expect(field.qFormat).toEqual({ m: 0, n: 0 });
  });

  it('defaults qFormat when m or n are missing', () => {
    const field1 = sanitizeField({
      name: 'F',
      msb: 15,
      lsb: 0,
      type: 'fixed-point',
      qFormat: { m: 8 },
    }) as FixedPointField;
    expect(field1.qFormat).toEqual({ m: 0, n: 0 });

    const field2 = sanitizeField({
      name: 'F',
      msb: 15,
      lsb: 0,
      type: 'fixed-point',
      qFormat: { n: 8 },
    }) as FixedPointField;
    expect(field2.qFormat).toEqual({ m: 0, n: 0 });
  });

  it('defaults qFormat when m or n are not numbers', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 15,
      lsb: 0,
      type: 'fixed-point',
      qFormat: { m: '8', n: '8' },
    }) as FixedPointField;
    expect(field.qFormat).toEqual({ m: 0, n: 0 });
  });

  it('preserves flagLabels when valid', () => {
    const field = sanitizeField({
      name: 'ENABLE',
      msb: 0,
      lsb: 0,
      type: 'flag',
      flagLabels: { clear: 'Disabled', set: 'Enabled' },
    }) as FlagField;
    expect(field.flagLabels).toEqual({ clear: 'Disabled', set: 'Enabled' });
  });

  it('omits flagLabels when not an object', () => {
    const field = sanitizeField({
      name: 'ENABLE',
      msb: 0,
      lsb: 0,
      type: 'flag',
      flagLabels: 'disabled/enabled',
    });
    expect('flagLabels' in field).toBe(false);
  });

  it('omits flagLabels when clear or set are missing or not strings', () => {
    const field1 = sanitizeField({
      name: 'ENABLE',
      msb: 0,
      lsb: 0,
      type: 'flag',
      flagLabels: { clear: 'Disabled' },
    });
    expect('flagLabels' in field1).toBe(false);

    const field2 = sanitizeField({
      name: 'ENABLE',
      msb: 0,
      lsb: 0,
      type: 'flag',
      flagLabels: { clear: 123, set: 456 },
    });
    expect('flagLabels' in field2).toBe(false);
  });

  it('defaults name to empty string when missing', () => {
    const field = sanitizeField({ msb: 0, lsb: 0, type: 'flag' });
    expect(field.name).toBe('');
  });

  it('defaults msb and lsb to 0 when missing', () => {
    const field = sanitizeField({ name: 'F', type: 'flag' });
    expect(field.msb).toBe(0);
    expect(field.lsb).toBe(0);
  });

  it('defaults msb and lsb to 0 for NaN, Infinity, and fractional values', () => {
    const cases = [NaN, Infinity, -Infinity, 3.5];
    for (const val of cases) {
      const field = sanitizeField({ name: 'F', msb: val, lsb: val, type: 'integer' });
      expect(field.msb).toBe(0);
      expect(field.lsb).toBe(0);
    }
  });

  it('defaults qFormat when m or n are not integers', () => {
    const field = sanitizeField({
      name: 'F',
      msb: 15,
      lsb: 0,
      type: 'fixed-point',
      qFormat: { m: 8.5, n: 7.5 },
    }) as FixedPointField;
    expect(field.qFormat).toEqual({ m: 0, n: 0 });
  });
});

describe('sanitizeRegisterDef', () => {
  it('picks only known properties, strips unknown ones', () => {
    const raw = {
      id: 'reg-1',
      name: 'STATUS',
      width: 32,
      fields: [],
      __proto__: 'hacked',
      evil: 'payload',
    };
    const reg = sanitizeRegisterDef(raw);
    expect(reg).toEqual({
      id: 'reg-1',
      name: 'STATUS',
      width: 32,
      fields: [],
    });
    expect('evil' in reg).toBe(false);
  });

  it('assigns UUID when id is missing', () => {
    const reg = sanitizeRegisterDef({ name: 'REG', width: 8, fields: [] });
    expect(typeof reg.id).toBe('string');
    expect(reg.id.length).toBeGreaterThan(0);
  });

  it('assigns UUID when id is empty string', () => {
    const reg = sanitizeRegisterDef({ id: '', name: 'REG', width: 8, fields: [] });
    expect(typeof reg.id).toBe('string');
    expect(reg.id.length).toBeGreaterThan(0);
    expect(reg.id).not.toBe('');
  });

  it('defaults fields to empty array when missing', () => {
    const reg = sanitizeRegisterDef({ name: 'REG', width: 8 });
    expect(reg.fields).toEqual([]);
  });

  it('defaults fields to empty array when not an array', () => {
    const reg = sanitizeRegisterDef({ name: 'REG', width: 8, fields: 'invalid' });
    expect(reg.fields).toEqual([]);
  });

  it('sanitizes nested fields', () => {
    const raw = {
      name: 'REG',
      width: 8,
      fields: [
        { name: 'F1', msb: 7, lsb: 4, type: 'integer', evil: 'payload' },
        { name: 'F2', msb: 3, lsb: 0, type: 'integer' },
      ],
    };
    const reg = sanitizeRegisterDef(raw);
    expect(reg.fields).toHaveLength(2);
    expect('evil' in (reg.fields[0] as Field)).toBe(false);
    expect(reg.fields[0].name).toBe('F1');
    expect(reg.fields[1].name).toBe('F2');
  });

  it('generates UUIDs for fields without IDs', () => {
    const raw = {
      name: 'REG',
      width: 8,
      fields: [
        { name: 'F', msb: 0, lsb: 0, type: 'flag' },
      ],
    };
    const reg = sanitizeRegisterDef(raw);
    expect(typeof reg.fields[0].id).toBe('string');
    expect(reg.fields[0].id.length).toBeGreaterThan(0);
  });

  it('preserves description when present', () => {
    const reg = sanitizeRegisterDef({
      name: 'STATUS',
      width: 32,
      fields: [],
      description: 'Status register',
    });
    expect(reg.description).toBe('Status register');
  });

  it('omits description when not a string', () => {
    const reg = sanitizeRegisterDef({
      name: 'STATUS',
      width: 32,
      fields: [],
      description: 123,
    });
    expect('description' in reg).toBe(false);
  });

  it('preserves offset when present', () => {
    const reg = sanitizeRegisterDef({
      name: 'STATUS',
      width: 32,
      fields: [],
      offset: 0x04,
    });
    expect(reg.offset).toBe(0x04);
  });

  it('omits offset when not a number', () => {
    const reg = sanitizeRegisterDef({
      name: 'STATUS',
      width: 32,
      fields: [],
      offset: '0x04',
    });
    expect('offset' in reg).toBe(false);
  });

  it('omits offset for NaN, Infinity, and fractional values', () => {
    const cases = [NaN, Infinity, -Infinity, 4.5];
    for (const val of cases) {
      const reg = sanitizeRegisterDef({ name: 'REG', width: 8, fields: [], offset: val });
      expect('offset' in reg).toBe(false);
    }
  });

  it('defaults name to empty string when missing', () => {
    const reg = sanitizeRegisterDef({ width: 8, fields: [] });
    expect(reg.name).toBe('');
  });

  it('defaults width to 0 when missing', () => {
    const reg = sanitizeRegisterDef({ name: 'REG', fields: [] });
    expect(reg.width).toBe(0);
  });

  it('defaults width to 0 when not a number', () => {
    const reg = sanitizeRegisterDef({ name: 'REG', width: '32', fields: [] });
    expect(reg.width).toBe(0);
  });

  it('defaults width to 0 for NaN, Infinity, and fractional values', () => {
    const cases = [NaN, Infinity, -Infinity, 8.5];
    for (const val of cases) {
      const reg = sanitizeRegisterDef({ name: 'REG', width: val, fields: [] });
      expect(reg.width).toBe(0);
    }
  });

  it('filters out non-object field entries', () => {
    const raw = {
      name: 'REG',
      width: 8,
      fields: [
        { name: 'F1', msb: 7, lsb: 0, type: 'integer' },
        'invalid string field',
        null,
        undefined,
        123,
        { name: 'F2', msb: 3, lsb: 0, type: 'integer' },
      ],
    };
    const reg = sanitizeRegisterDef(raw);
    expect(reg.fields).toHaveLength(2);
    expect(reg.fields[0].name).toBe('F1');
    expect(reg.fields[1].name).toBe('F2');
  });

  it('round-trips a complete register definition', () => {
    const raw = {
      id: 'reg-123',
      name: 'CONTROL',
      description: 'Control register',
      width: 16,
      offset: 0x10,
      fields: [
        {
          id: 'field-1',
          name: 'ENABLE',
          description: 'Enable bit',
          msb: 15,
          lsb: 15,
          type: 'flag',
          flagLabels: { clear: 'Disabled', set: 'Enabled' },
        },
        {
          id: 'field-2',
          name: 'MODE',
          msb: 14,
          lsb: 12,
          type: 'enum',
          enumEntries: [
            { value: 0, name: 'MODE_A' },
            { value: 1, name: 'MODE_B' },
          ],
        },
        {
          id: 'field-3',
          name: 'VALUE',
          msb: 11,
          lsb: 0,
          type: 'integer',
          signed: true,
        },
      ],
    };
    const reg = sanitizeRegisterDef(raw) as RegisterDef;
    expect(reg.id).toBe('reg-123');
    expect(reg.name).toBe('CONTROL');
    expect(reg.description).toBe('Control register');
    expect(reg.width).toBe(16);
    expect(reg.offset).toBe(0x10);
    expect(reg.fields).toHaveLength(3);
    expect((reg.fields[0] as FlagField).flagLabels).toEqual({ clear: 'Disabled', set: 'Enabled' });
    expect((reg.fields[1] as EnumField).enumEntries).toEqual([
      { value: 0, name: 'MODE_A' },
      { value: 1, name: 'MODE_B' },
    ]);
    expect((reg.fields[2] as IntegerField).signedness).toBe('twos-complement');
  });
});
