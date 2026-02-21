export type FieldType = 'flag' | 'enum' | 'integer' | 'float' | 'fixed-point';

export interface EnumEntry {
  value: number;
  name: string;
}

export interface QFormat {
  m: number; // integer bits
  n: number; // fractional bits
}

export interface BaseField {
  id: string;
  name: string;
  description?: string;
  msb: number; // most significant bit (inclusive)
  lsb: number; // least significant bit (inclusive)
}

export interface FlagField extends BaseField {
  type: 'flag';
  flagLabels?: { clear: string; set: string };
}

export interface EnumField extends BaseField {
  type: 'enum';
  enumEntries: EnumEntry[];
}

export type Signedness = 'unsigned' | 'twos-complement' | 'sign-magnitude';

export interface IntegerField extends BaseField {
  type: 'integer';
  signedness?: Signedness;
}

export interface FloatField extends BaseField {
  type: 'float';
  floatType: 'half' | 'single' | 'double';
}

export interface FixedPointField extends BaseField {
  type: 'fixed-point';
  qFormat: QFormat;
}

export type Field = FlagField | EnumField | IntegerField | FloatField | FixedPointField;

/** Flat representation with all type-specific properties optional. Used for form drafts. */
export interface FieldDraft {
  id: string;
  name: string;
  description?: string;
  msb: number;
  lsb: number;
  type: FieldType;
  signedness?: Signedness;
  enumEntries?: EnumEntry[];
  floatType?: 'half' | 'single' | 'double';
  qFormat?: QFormat;
  flagLabels?: { clear: string; set: string };
}

/** Convert a flat FieldDraft into the proper discriminated union Field. */
export function toField(draft: FieldDraft): Field {
  const base = { id: draft.id, name: draft.name, description: draft.description, msb: draft.msb, lsb: draft.lsb };
  switch (draft.type) {
    case 'flag':
      return { ...base, type: 'flag', flagLabels: draft.flagLabels };
    case 'enum':
      return { ...base, type: 'enum', enumEntries: draft.enumEntries ?? [] };
    case 'integer':
      return { ...base, type: 'integer', signedness: draft.signedness };
    case 'float':
      return { ...base, type: 'float', floatType: draft.floatType ?? 'single' };
    case 'fixed-point':
      return { ...base, type: 'fixed-point', qFormat: draft.qFormat ?? { m: 0, n: 0 } };
  }
}

/** Convert a Field union back into a flat FieldDraft for form editing. */
export function toFieldDraft(field: Field): FieldDraft {
  const base = { id: field.id, name: field.name, description: field.description, msb: field.msb, lsb: field.lsb, type: field.type };
  switch (field.type) {
    case 'flag':        return { ...base, flagLabels: field.flagLabels };
    case 'enum':        return { ...base, enumEntries: field.enumEntries };
    case 'integer':     return { ...base, signedness: field.signedness };
    case 'float':       return { ...base, floatType: field.floatType };
    case 'fixed-point': return { ...base, qFormat: field.qFormat };
  }
}

export interface ProjectMetadata {
  title?: string;
  description?: string;
  date?: string;
  authorEmail?: string;
  link?: string;
}

export interface RegisterDef {
  id: string;
  name: string;
  description?: string;
  width: number; // total bits
  offset?: number; // address offset in address units (unit size is project-level addressUnitBits)
  fields: Field[];
}

export const SIDEBAR_WIDTH_MIN = 180;
export const SIDEBAR_WIDTH_MAX = 400;
export const SIDEBAR_WIDTH_DEFAULT = 224;

export type MapTableWidth = 8 | 16 | 32 | 64 | 128;
export const MAP_TABLE_WIDTH_VALUES: readonly MapTableWidth[] = [8, 16, 32, 64, 128];

export type AddressUnitBits = 8 | 16 | 32 | 64 | 128;
export const ADDRESS_UNIT_BITS_VALUES: readonly AddressUnitBits[] = [8, 16, 32, 64, 128];
export const ADDRESS_UNIT_BITS_DEFAULT: AddressUnitBits = 8;

export interface AppState {
  registers: RegisterDef[];
  activeRegisterId: string | null;
  registerValues: Record<string, bigint>; // defId -> current value
  theme: 'light' | 'dark';
  project?: ProjectMetadata;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  mapTableWidth: MapTableWidth;
  mapShowGaps: boolean;
  addressUnitBits: AddressUnitBits;
}

/** Serializable version of AppState for localStorage / JSON export */
export interface SerializedAppState {
  registers: RegisterDef[];
  activeRegisterId: string | null;
  registerValues: Record<string, string>; // defId -> hex string
  theme: 'light' | 'dark';
  project?: ProjectMetadata;
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  mapTableWidth?: MapTableWidth;
  mapShowGaps?: boolean;
  addressUnitBits?: AddressUnitBits;
}

export type DecodedValue =
  | { type: 'flag'; value: boolean }
  | { type: 'enum'; value: number; name: string | null }
  | { type: 'integer'; value: number | bigint | '-0' }
  | { type: 'float'; value: number }
  | { type: 'fixed-point'; value: number };
