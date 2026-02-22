import { describe, it, expect } from 'vitest';
import { validateProjectData } from './validation';
import { LIMITS } from './types';

describe('validateProjectData', () => {
  describe('valid payloads', () => {
    it('accepts minimal valid project', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'TEST_REG',
            width: 8,
            fields: [],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(true);
    });

    it('accepts project with all optional fields', () => {
      const data = {
        version: 1,
        registers: [
          {
            id: 'reg-1',
            name: 'TEST_REG',
            width: 32,
            offset: 0x00,
            description: 'Test register',
            fields: [
              {
                name: 'FIELD1',
                type: 'integer',
                msb: 7,
                lsb: 0,
              },
            ],
          },
        ],
        registerValues: {
          'reg-1': '0xFF',
        },
        project: {
          title: 'Test Project',
          description: 'A test project',
          date: '2024-01-01',
          authorEmail: 'test@example.com',
          link: 'https://example.com',
        },
        addressUnitBits: 8,
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(true);
    });

    it('accepts all field types', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 64,
            fields: [
              { name: 'FLAG', type: 'flag', msb: 0, lsb: 0 },
              { name: 'INT', type: 'integer', msb: 7, lsb: 1 },
              {
                name: 'ENUM',
                type: 'enum',
                msb: 15,
                lsb: 8,
                enumEntries: [
                  { value: 0, name: 'A' },
                  { value: 1, name: 'B' },
                ],
              },
              { name: 'FLOAT', type: 'float', msb: 31, lsb: 16 },
              { name: 'FIXED', type: 'fixed-point', msb: 47, lsb: 32 },
            ],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(true);
    });

    it('accepts multiple registers', () => {
      const data = {
        version: 1,
        registers: [
          { name: 'REG1', width: 8, fields: [] },
          { name: 'REG2', width: 16, fields: [] },
          { name: 'REG3', width: 32, fields: [] },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(true);
    });

    it('accepts hex register values', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 32, fields: [] }],
        registerValues: {
          reg1: '0x0',
          reg2: '0xFF',
          reg3: '0xDEADBEEF',
          reg4: '0xdeadbeef',
        },
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(true);
    });

    it('accepts all valid addressUnitBits values', () => {
      LIMITS.VALID_ADDRESS_UNIT_BITS.forEach((bits) => {
        const data = {
          version: 1,
          registers: [{ name: 'REG', width: 8, fields: [] }],
          registerValues: {},
          addressUnitBits: bits,
        };

        const result = validateProjectData(data);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('structural validation errors', () => {
    it('rejects non-object input', () => {
      expect(validateProjectData(null).valid).toBe(false);
      expect(validateProjectData(undefined).valid).toBe(false);
      expect(validateProjectData('string').valid).toBe(false);
      expect(validateProjectData(123).valid).toBe(false);
      expect(validateProjectData([]).valid).toBe(false);
    });

    it('rejects missing version', () => {
      const data = {
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('version');
      }
    });

    it('rejects invalid version', () => {
      const data = {
        version: 2,
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('version must be 1');
      }
    });

    it('rejects non-array registers', () => {
      const data = {
        version: 1,
        registers: {},
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('registers must be an array');
      }
    });

    it('rejects empty registers array', () => {
      const data = {
        version: 1,
        registers: [],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('at least 1 register');
      }
    });

    it('rejects too many registers', () => {
      const registers = Array.from({ length: LIMITS.MAX_REGISTERS + 1 }, (_, i) => ({
        name: `REG${i}`,
        width: 8,
        fields: [],
      }));

      const data = {
        version: 1,
        registers,
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('at most');
        expect(result.error).toContain(String(LIMITS.MAX_REGISTERS));
      }
    });

    it('rejects non-object registerValues', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: [],
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('registerValues must be an object');
      }
    });

    it('rejects missing registerValues', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: [] }],
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('registerValues');
      }
    });

    it('rejects non-string registerValues entries', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: {
          reg1: 123,
        },
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('must be a string');
      }
    });

    it('rejects invalid hex format in registerValues', () => {
      const invalidValues = [
        'FF', // missing 0x prefix
        '0xGG', // invalid hex characters
        '0x', // no digits
        'invalid',
      ];

      invalidValues.forEach((val) => {
        const data = {
          version: 1,
          registers: [{ name: 'REG', width: 8, fields: [] }],
          registerValues: { reg: val },
        };

        const result = validateProjectData(data);
        expect(result.valid).toBe(false);
      });
    });

    it('rejects invalid addressUnitBits', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: {},
        addressUnitBits: 7, // not in valid list
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('addressUnitBits');
      }
    });
  });

  describe('register validation errors', () => {
    it('rejects register with missing name', () => {
      const data = {
        version: 1,
        registers: [{ width: 8, fields: [] }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('name');
      }
    });

    it('rejects register with empty name', () => {
      const data = {
        version: 1,
        registers: [{ name: '', width: 8, fields: [] }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('non-empty');
      }
    });

    it('rejects register with name too long', () => {
      const data = {
        version: 1,
        registers: [{ name: 'A'.repeat(LIMITS.MAX_NAME_LENGTH + 1), width: 8, fields: [] }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('at most');
        expect(result.error).toContain(String(LIMITS.MAX_NAME_LENGTH));
      }
    });

    it('rejects register with invalid width', () => {
      const invalidWidths = [0, -1, 0.5, LIMITS.MAX_REGISTER_WIDTH + 1];

      invalidWidths.forEach((width) => {
        const data = {
          version: 1,
          registers: [{ name: 'REG', width, fields: [] }],
          registerValues: {},
        };

        const result = validateProjectData(data);
        expect(result.valid).toBe(false);
      });
    });

    it('rejects register with non-array fields', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: {} }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('fields must be an array');
      }
    });

    it('rejects register with too many fields', () => {
      const fields = Array.from({ length: LIMITS.MAX_FIELDS_PER_REGISTER + 1 }, (_, i) => ({
        name: `FIELD${i}`,
        type: 'flag',
        msb: i,
        lsb: i,
      }));

      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 128, fields }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('at most');
        expect(result.error).toContain(String(LIMITS.MAX_FIELDS_PER_REGISTER));
      }
    });

    it('rejects register with negative offset', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, offset: -1, fields: [] }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('offset');
        expect(result.error).toContain('non-negative');
      }
    });

    it('rejects register with non-integer offset', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, offset: 1.5, fields: [] }],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
    });
  });

  describe('field validation errors', () => {
    it('rejects field with missing name', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [{ type: 'flag', msb: 0, lsb: 0 }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('name');
      }
    });

    it('rejects field with empty name', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [{ name: '', type: 'flag', msb: 0, lsb: 0 }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
    });

    it('rejects field with invalid type', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [{ name: 'FIELD', type: 'invalid-type', msb: 7, lsb: 0 }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('type must be one of');
      }
    });

    it('rejects field with negative msb', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [{ name: 'FIELD', type: 'integer', msb: -1, lsb: 0 }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('msb');
        expect(result.error).toContain('non-negative');
      }
    });

    it('rejects field with negative lsb', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [{ name: 'FIELD', type: 'integer', msb: 7, lsb: -1 }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('lsb');
        expect(result.error).toContain('non-negative');
      }
    });

    it('rejects enum field without enumEntries', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [{ name: 'ENUM', type: 'enum', msb: 7, lsb: 0 }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('enumEntries');
      }
    });

    it('rejects enum field with non-array enumEntries', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [{ name: 'ENUM', type: 'enum', msb: 7, lsb: 0, enumEntries: {} }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
    });

    it('rejects enum field with too many entries', () => {
      const enumEntries = Array.from({ length: LIMITS.MAX_ENUM_ENTRIES + 1 }, (_, i) => ({
        value: i,
        name: `ENTRY${i}`,
      }));

      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 16,
            fields: [{ name: 'ENUM', type: 'enum', msb: 15, lsb: 0, enumEntries }],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('at most');
        expect(result.error).toContain(String(LIMITS.MAX_ENUM_ENTRIES));
      }
    });

    it('rejects enum entry with non-integer value', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [
              {
                name: 'ENUM',
                type: 'enum',
                msb: 7,
                lsb: 0,
                enumEntries: [{ value: 'invalid', name: 'A' }],
              },
            ],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('value must be an integer');
      }
    });

    it('rejects enum entry with empty name', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 8,
            fields: [
              {
                name: 'ENUM',
                type: 'enum',
                msb: 7,
                lsb: 0,
                enumEntries: [{ value: 0, name: '' }],
              },
            ],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
    });
  });

  describe('project metadata validation', () => {
    it('rejects non-object metadata', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: {},
        project: 'invalid',
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('metadata');
      }
    });

    it('rejects metadata with non-string fields', () => {
      const invalidFields = ['title', 'description', 'date', 'authorEmail', 'link'];

      invalidFields.forEach((field) => {
        const data = {
          version: 1,
          registers: [{ name: 'REG', width: 8, fields: [] }],
          registerValues: {},
          project: {
            [field]: 123,
          },
        };

        const result = validateProjectData(data);
        expect(result.valid).toBe(false);
      });
    });

    it('rejects metadata with fields too long', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: {},
        project: {
          title: 'A'.repeat(LIMITS.MAX_METADATA_STRING_LENGTH + 1),
        },
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('at most');
        expect(result.error).toContain(String(LIMITS.MAX_METADATA_STRING_LENGTH));
      }
    });

    it('accepts metadata at max length', () => {
      const data = {
        version: 1,
        registers: [{ name: 'REG', width: 8, fields: [] }],
        registerValues: {},
        project: {
          title: 'A'.repeat(LIMITS.MAX_METADATA_STRING_LENGTH),
        },
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(true);
    });
  });

  describe('error messages', () => {
    it('includes array index in error messages', () => {
      const data = {
        version: 1,
        registers: [
          { name: 'REG1', width: 8, fields: [] },
          { name: '', width: 8, fields: [] }, // Invalid: empty name
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('[1]');
      }
    });

    it('includes field index in error messages', () => {
      const data = {
        version: 1,
        registers: [
          {
            name: 'REG',
            width: 16,
            fields: [
              { name: 'FIELD1', type: 'flag', msb: 0, lsb: 0 },
              { name: '', type: 'flag', msb: 1, lsb: 1 }, // Invalid: empty name
            ],
          },
        ],
        registerValues: {},
      };

      const result = validateProjectData(data);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.error).toContain('[0]'); // register index
        expect(result.error).toContain('[1]'); // field index
      }
    });
  });
});
