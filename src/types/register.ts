export type FieldType = 'flag' | 'enum' | 'integer' | 'float' | 'fixed-point';

export interface EnumEntry {
  value: number;
  name: string;
}

export interface QFormat {
  m: number; // integer bits
  n: number; // fractional bits
}

export interface Field {
  id: string;
  name: string;
  description?: string;
  msb: number; // most significant bit (inclusive)
  lsb: number; // least significant bit (inclusive)
  type: FieldType;
  signed?: boolean;          // for 'integer'
  enumEntries?: EnumEntry[]; // for 'enum'
  floatType?: 'half' | 'single' | 'double'; // for 'float'
  qFormat?: QFormat;         // for 'fixed-point' (Qm.n)
  flagLabels?: { clear: string; set: string }; // for 'flag'
}

export interface RegisterDef {
  id: string;
  name: string;
  description?: string;
  width: number; // total bits
  offset?: number; // byte address offset
  fields: Field[];
}

export interface AppState {
  registers: RegisterDef[];
  activeRegisterId: string | null;
  registerValues: Record<string, bigint>; // defId -> current value
  theme: 'light' | 'dark';
}

/** Serializable version of AppState for localStorage / JSON export */
export interface SerializedAppState {
  registers: RegisterDef[];
  activeRegisterId: string | null;
  registerValues: Record<string, string>; // defId -> hex string
  theme: 'light' | 'dark';
}

export type DecodedValue =
  | { type: 'flag'; value: boolean }
  | { type: 'enum'; value: number; name: string | null }
  | { type: 'integer'; value: number | bigint }
  | { type: 'float'; value: number }
  | { type: 'fixed-point'; value: number };
