// ---- KV Environment Binding ----

export interface Env {
  PROJECTS: KVNamespace;
  APP_URL: string;
  ALLOWED_ORIGINS?: string; // comma-separated, optional override
}

// ---- Project Data (matches frontend export format) ----

interface ProjectMetadata {
  title?: string;
  description?: string;
  date?: string;
  authorEmail?: string;
  link?: string;
}

export interface ProjectData {
  version: number;
  registers: unknown[]; // Opaque - Worker validates structure, not semantics
  registerValues: Record<string, string>;
  project?: ProjectMetadata;
  addressUnitBits?: number;
}

// ---- Stored Record (KV value) ----

export interface StoredProject {
  schemaVersion: 1;
  id: string;
  ownerTokenHash: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  lastAccessedAt: string; // ISO 8601
  data: ProjectData;
}

// ---- API Responses ----

export interface CreateProjectResponse {
  id: string;
  shareUrl: string;
  createdAt: string;
}

export interface GetProjectResponse {
  id: string;
  data: ProjectData;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProjectResponse {
  id: string;
  updatedAt: string;
}

// ---- Validation Result ----

export type ValidationResult =
  | { valid: true }
  | { valid: false; error: string };

// ---- Limits ----

export const LIMITS = {
  /** Maximum number of registers per project */
  MAX_REGISTERS: 256,
  /** Maximum register width in bits */
  MAX_REGISTER_WIDTH: 1024,
  /** Maximum number of fields per register */
  MAX_FIELDS_PER_REGISTER: 64,
  /** Maximum number of enum entries per field */
  MAX_ENUM_ENTRIES: 256,
  /** Maximum length for register/field names */
  MAX_NAME_LENGTH: 200,
  /** Maximum length for metadata string fields */
  MAX_METADATA_STRING_LENGTH: 500,
  /** Maximum total payload size in bytes (512 KB) */
  MAX_PAYLOAD_SIZE: 512 * 1024,
  /** Valid addressUnitBits values */
  VALID_ADDRESS_UNIT_BITS: [8, 16, 32, 64, 128] as readonly number[],
} as const;
