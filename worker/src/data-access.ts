import type { StoredProject } from './types';

/**
 * Format the KV key for a project.
 *
 * All project records are stored under the `project:` prefix,
 * keeping the namespace tidy for future key types (e.g. analytics, rate limits).
 */
export function projectKey(id: string): string {
  return `project:${id}`;
}

/**
 * Retrieve a stored project from KV by ID.
 *
 * Returns null if the project does not exist or the stored value is not valid JSON.
 * Runs schema migration on the raw value to ensure the returned object
 * always conforms to the latest StoredProject shape.
 */
export async function getProject(kv: KVNamespace, id: string): Promise<StoredProject | null> {
  const raw = await kv.get(projectKey(id), 'json');
  if (raw === null) return null;

  try {
    return migrateStoredProject(raw);
  } catch {
    // If migration fails, the stored data is corrupt — treat as not found
    return null;
  }
}

/**
 * Write a StoredProject to KV.
 *
 * Projects are stored as JSON with no explicit TTL (they live until deleted).
 * KV's eventual consistency means reads may take up to 60s to reflect writes
 * in other regions, but this is acceptable for a sharing use case.
 */
export async function putProject(kv: KVNamespace, project: StoredProject): Promise<void> {
  await kv.put(projectKey(project.id), JSON.stringify(project));
}

/**
 * Update only the lastAccessedAt timestamp without re-serializing the full project.
 *
 * Reads the raw JSON string from KV, patches the timestamp via string
 * replacement, and writes it back. Avoids JSON.parse + JSON.stringify
 * of potentially large project data on the read path.
 */
export async function touchLastAccessed(kv: KVNamespace, id: string, isoTimestamp: string): Promise<void> {
  const raw = await kv.get(projectKey(id), 'text');
  if (!raw) return;

  const patched = raw.replace(
    /"lastAccessedAt"\s*:\s*"[^"]*"/,
    `"lastAccessedAt":"${isoTimestamp}"`,
  );

  if (patched !== raw) {
    await kv.put(projectKey(id), patched);
  }
}

/**
 * Delete a project from KV by ID.
 *
 * This is idempotent — deleting a non-existent key is a no-op in KV.
 */
export async function deleteProject(kv: KVNamespace, id: string): Promise<void> {
  await kv.delete(projectKey(id));
}

/**
 * Migrate a raw KV value to the latest StoredProject schema.
 *
 * Currently handles:
 * - v0 (implicit): records written before schemaVersion was introduced.
 *   These lack `schemaVersion`, `lastAccessedAt`, and possibly other fields.
 * - v1: current schema, returned as-is after type assertion.
 *
 * Throws if the input is fundamentally unusable (not an object, missing id, etc.).
 */
export function migrateStoredProject(raw: unknown): StoredProject {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Stored project is not an object');
  }

  const record = raw as Record<string, unknown>;

  // Must have an id at minimum
  if (typeof record.id !== 'string' || record.id.length === 0) {
    throw new Error('Stored project is missing a valid id');
  }

  // Must have data
  if (!record.data || typeof record.data !== 'object') {
    throw new Error('Stored project is missing data');
  }

  // Must have ownerTokenHash
  if (typeof record.ownerTokenHash !== 'string') {
    throw new Error('Stored project is missing ownerTokenHash');
  }

  const now = new Date().toISOString();

  // v0 -> v1: backfill missing fields
  const schemaVersion = record.schemaVersion;
  if (schemaVersion === undefined || schemaVersion === 0) {
    return {
      schemaVersion: 1,
      id: record.id as string,
      ownerTokenHash: record.ownerTokenHash as string,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
      lastAccessedAt: typeof record.lastAccessedAt === 'string' ? record.lastAccessedAt : now,
      data: record.data as StoredProject['data'],
    };
  }

  // v1: current schema — pass through with defaults for any missing timestamps
  if (schemaVersion === 1) {
    return {
      schemaVersion: 1,
      id: record.id as string,
      ownerTokenHash: record.ownerTokenHash as string,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
      lastAccessedAt: typeof record.lastAccessedAt === 'string' ? record.lastAccessedAt : now,
      data: record.data as StoredProject['data'],
    };
  }

  // Unknown future schema version — attempt best-effort passthrough
  // This allows forward compatibility if a newer worker writes v2 records
  // and an older worker instance reads them during a rolling deploy.
  return {
    schemaVersion: 1,
    id: record.id as string,
    ownerTokenHash: record.ownerTokenHash as string,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
    lastAccessedAt: typeof record.lastAccessedAt === 'string' ? record.lastAccessedAt : now,
    data: record.data as StoredProject['data'],
  };
}
