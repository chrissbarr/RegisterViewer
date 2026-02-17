import type { Field, RegisterDef } from '../types/register';

function fieldsEqual(a: Field, b: Field): boolean {
  if (
    a.type !== b.type ||
    a.id !== b.id ||
    a.name !== b.name ||
    a.description !== b.description ||
    a.msb !== b.msb ||
    a.lsb !== b.lsb
  ) return false;

  switch (a.type) {
    case 'flag': {
      const bf = b as typeof a;
      const aLabels = a.flagLabels;
      const bLabels = bf.flagLabels;
      if (!aLabels && !bLabels) return true;
      if (!aLabels || !bLabels) return false;
      return aLabels.clear === bLabels.clear && aLabels.set === bLabels.set;
    }
    case 'enum': {
      const be = b as typeof a;
      if (a.enumEntries.length !== be.enumEntries.length) return false;
      for (let i = 0; i < a.enumEntries.length; i++) {
        if (a.enumEntries[i].value !== be.enumEntries[i].value ||
            a.enumEntries[i].name !== be.enumEntries[i].name) return false;
      }
      return true;
    }
    case 'integer':
      return a.signed === (b as typeof a).signed;
    case 'float':
      return a.floatType === (b as typeof a).floatType;
    case 'fixed-point': {
      const bfp = b as typeof a;
      return a.qFormat.m === bfp.qFormat.m && a.qFormat.n === bfp.qFormat.n;
    }
  }
}

export function registersEqual(a: RegisterDef, b: RegisterDef): boolean {
  if (
    a.id !== b.id ||
    a.name !== b.name ||
    a.description !== b.description ||
    a.width !== b.width ||
    a.offset !== b.offset ||
    a.fields.length !== b.fields.length
  ) return false;

  for (let i = 0; i < a.fields.length; i++) {
    if (!fieldsEqual(a.fields[i], b.fields[i])) return false;
  }
  return true;
}
