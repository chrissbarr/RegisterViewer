import type { StoredProject, Visibility } from './types';

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
 * Format the KV key for the owner secondary index.
 *
 * Allows listing all projects owned by a given token hash.
 * Key format: `owner:{tokenHash}:{projectId}` → "1"
 */
export function ownerIndexKey(tokenHash: string, projectId: string): string {
  return `owner:${tokenHash}:${projectId}`;
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
 * Write a StoredProject to KV and update the owner index.
 *
 * Write order: project key first, then owner index.
 * This ensures the project data is always accessible even if the index write fails.
 */
export async function putProject(kv: KVNamespace, project: StoredProject): Promise<void> {
  await kv.put(projectKey(project.id), JSON.stringify(project));
  await kv.put(ownerIndexKey(project.ownerTokenHash, project.id), '1');
}

/**
 * Update only the lastAccessedAt timestamp on a stored project.
 *
 * This runs at most once per 24 hours per project (throttled by the caller),
 * so the cost of a full parse + serialize round-trip is negligible.
 */
export async function touchLastAccessed(kv: KVNamespace, id: string, isoTimestamp: string): Promise<void> {
  const project = await getProject(kv, id);
  if (!project) return;

  project.lastAccessedAt = isoTimestamp;
  // Write directly to project key — no need to update owner index for timestamp
  await kv.put(projectKey(project.id), JSON.stringify(project));
}

/**
 * Delete a project from KV by ID, including its owner index entry.
 *
 * Deletes the owner index key first, then the project key.
 * This is idempotent — deleting a non-existent key is a no-op in KV.
 */
export async function deleteProject(kv: KVNamespace, id: string, ownerTokenHash: string): Promise<void> {
  await kv.delete(ownerIndexKey(ownerTokenHash, id));
  await kv.delete(projectKey(id));
}

/**
 * List all projects owned by a given token hash.
 *
 * Uses the owner secondary index (prefix scan) to find project IDs,
 * then fetches each project. Filters out null results to handle
 * phantom index entries from eventual consistency.
 */
export async function listProjectsByOwner(kv: KVNamespace, tokenHash: string): Promise<StoredProject[]> {
  const prefix = `owner:${tokenHash}:`;
  const projects: StoredProject[] = [];

  let cursor: string | undefined;

  for (;;) {
    const listResult = await kv.list({ prefix, cursor });
    for (const key of listResult.keys) {
      const projectId = key.name.slice(prefix.length);
      const project = await getProject(kv, projectId);
      if (project) {
        projects.push(project);
      }
    }
    if (listResult.list_complete) break;
    cursor = (listResult as { cursor: string }).cursor;
  }

  return projects;
}

const VALID_VISIBILITIES: readonly Visibility[] = ['private', 'unlisted'];

/**
 * Check whether a string is a valid visibility value.
 */
export function isValidVisibility(value: unknown): value is Visibility {
  return typeof value === 'string' && VALID_VISIBILITIES.includes(value as Visibility);
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
  const visibility: Visibility = isValidVisibility(record.visibility) ? record.visibility : 'private';

  // v0 -> v1: backfill missing fields
  const schemaVersion = record.schemaVersion;
  if (schemaVersion === undefined || schemaVersion === 0) {
    return {
      schemaVersion: 1,
      id: record.id as string,
      ownerTokenHash: record.ownerTokenHash as string,
      visibility,
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
      visibility,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
      lastAccessedAt: typeof record.lastAccessedAt === 'string' ? record.lastAccessedAt : now,
      data: record.data as StoredProject['data'],
    };
  }

  // Unknown future schema version — attempt best-effort passthrough
  return {
    schemaVersion: 1,
    id: record.id as string,
    ownerTokenHash: record.ownerTokenHash as string,
    visibility,
    createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
    lastAccessedAt: typeof record.lastAccessedAt === 'string' ? record.lastAccessedAt : now,
    data: record.data as StoredProject['data'],
  };
}
