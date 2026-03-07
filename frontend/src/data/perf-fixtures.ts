import type { Field, FlagField, EnumField, IntegerField, RegisterDef } from '../types/register';

function makeStressFields(width: number, fieldCount: number): Field[] {
  const fields: Field[] = [];
  const totalBits = width;
  const bitsPerField = Math.max(1, Math.floor(totalBits / fieldCount));
  let currentBit = 0;

  for (let i = 0; i < fieldCount && currentBit < totalBits; i++) {
    const lsb = currentBit;
    const remainingFields = fieldCount - i;
    const remainingBits = totalBits - currentBit;
    const fieldWidth = i === fieldCount - 1
      ? remainingBits
      : Math.min(bitsPerField, remainingBits - (remainingFields - 1));
    const msb = lsb + fieldWidth - 1;

    const id = `stress-field-${i}`;
    const name = `field_${i}`;

    let field: Field;
    if (fieldWidth === 1) {
      field = { id, name, msb, lsb, type: 'flag' } as FlagField;
    } else if (i % 3 === 1 && fieldWidth <= 4) {
      const entries = Array.from({ length: Math.min(1 << fieldWidth, 4) }, (_, v) => ({
        value: v,
        name: `${name}_opt${v}`,
      }));
      field = { id, name, msb, lsb, type: 'enum', enumEntries: entries } as EnumField;
    } else {
      field = { id, name, msb, lsb, type: 'integer' } as IntegerField;
    }

    fields.push(field);
    currentBit = msb + 1;
  }

  return fields;
}

export function makeStressRegister(width: number, fieldCount: number): RegisterDef {
  return {
    id: `stress-reg-${width}-${fieldCount}`,
    name: `STRESS_${width}_${fieldCount}`,
    width,
    fields: makeStressFields(width, fieldCount),
  };
}

export const STRESS_32_8 = makeStressRegister(32, 8);
export const STRESS_64_16 = makeStressRegister(64, 16);
export const STRESS_128_32 = makeStressRegister(128, 32);

