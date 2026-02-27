import {
  DEFAULT_PROJECT_NAME,
  type ProjectManifest,
  type ProjectManifestEntry,
  type StoredLocalProject,
  type ProjectListEntry,
} from '../types/project';
import type { SerializedAppState } from '../types/register';

export function buildProjectUrl(cloudId: string): string {
  return `${window.location.href.split('#')[0]}#/p/${cloudId}`;
}

const MANIFEST_KEY = 'register-viewer-manifest';
const PROJECT_PREFIX = 'register-viewer-project:';
const LEGACY_STATE_KEY = 'register-viewer-state';
const LEGACY_PROJECTS_KEY = 'register-viewer-projects';
export const ACTIVE_PROJECT_SESSION_KEY = 'register-viewer-active-project';

/**
 * In-memory manifest cache to avoid repeated localStorage reads + JSON parses.
 *
 * Limitation: this cache is per-tab. If the user has multiple tabs open,
 * writes in one tab are not visible to another until the cache is
 * invalidated (e.g., by saveManifest or invalidateManifestCache).
 * This is acceptable because the app is designed as a single-tab experience.
 */
let cachedManifest: ProjectManifest | null = null;

/** Invalidate the in-memory manifest cache (for testing) */
export function invalidateManifestCache(): void {
  cachedManifest = null;
}

export function projectStorageKey(localId: string): string {
  return `${PROJECT_PREFIX}${localId}`;
}

/** Generate a UUID v4 using crypto.randomUUID() */
function generateLocalId(): string {
  return crypto.randomUUID();
}

/** Convert a StoredLocalProject to a ProjectManifestEntry */
function toManifestEntry(project: StoredLocalProject): ProjectManifestEntry {
  return {
    localId: project.localId,
    cloudId: project.cloudId,
    name: project.name,
    visibility: project.visibility,
    createdAt: project.createdAt,
    localSavedAt: project.localSavedAt,
    cloudSavedAt: project.cloudSavedAt,
  };
}

/** Convert a ProjectManifestEntry to a ProjectListEntry (UI view, no secrets) */
export function toProjectListEntry(entry: ProjectManifestEntry): ProjectListEntry {
  return {
    ...entry,
    isCloudSaved: entry.cloudId !== null,
  };
}

/** Scan localStorage for orphaned project keys not in the manifest */
function recoverOrphanedProjects(manifest: ProjectManifest): ProjectManifest {
  const knownIds = new Set(manifest.projects.map(p => p.localId));
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(PROJECT_PREFIX)) continue;
    const localId = key.slice(PROJECT_PREFIX.length);
    if (knownIds.has(localId)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;
    try {
      const record: StoredLocalProject = JSON.parse(raw);
      manifest.projects.push(toManifestEntry(record));
    } catch {
      /* corrupt data, skip */
    }
  }
  return manifest;
}

/** Load the project manifest from cache or localStorage.
 *  Returns a shallow copy so callers cannot accidentally mutate the cache. */
export function loadManifest(): ProjectManifest {
  if (!cachedManifest) {
    try {
      const raw = localStorage.getItem(MANIFEST_KEY);
      if (!raw) {
        cachedManifest = { version: 1, projects: [] };
      } else {
        const parsed = JSON.parse(raw) as ProjectManifest;
        if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
          cachedManifest = { version: 1, projects: [] };
        } else {
          cachedManifest = parsed;
        }
      }
    } catch {
      cachedManifest = { version: 1, projects: [] };
    }
  }
  return { ...cachedManifest, projects: [...cachedManifest.projects] };
}

/** Save the manifest to localStorage and update cache */
export function saveManifest(manifest: ProjectManifest): void {
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
  cachedManifest = manifest;
}

/** Validate that a parsed object has the minimum shape of a StoredLocalProject */
function isValidStoredProject(obj: unknown): obj is StoredLocalProject {
  if (typeof obj !== 'object' || obj === null) return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.localId === 'string' &&
    typeof p.name === 'string' &&
    typeof p.state === 'object' && p.state !== null &&
    Array.isArray((p.state as Record<string, unknown>).registers) &&
    typeof (p.state as Record<string, unknown>).registerValues === 'object'
  );
}

/** Load a single project by localId */
export function loadProject(localId: string): StoredLocalProject | null {
  try {
    const raw = localStorage.getItem(projectStorageKey(localId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidStoredProject(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Save a project record. Writes project key first, then updates manifest. */
export function saveProject(project: StoredLocalProject): void {
  // Update timestamp without mutating input
  const updated = { ...project, localSavedAt: new Date().toISOString() };

  // Step 1: Write project data first (safety: data is always reachable)
  localStorage.setItem(projectStorageKey(updated.localId), JSON.stringify(updated));

  // Step 2: Update manifest
  const manifest = loadManifest();
  const idx = manifest.projects.findIndex(p => p.localId === updated.localId);
  const entry = toManifestEntry(updated);
  if (idx >= 0) {
    manifest.projects[idx] = entry;
  } else {
    manifest.projects.push(entry);
  }
  saveManifest(manifest);
}

/** Create a new project with initial state, returns the localId */
export function createProject(initialState: SerializedAppState, name?: string): string {
  const localId = generateLocalId();
  const now = new Date().toISOString();
  const project: StoredLocalProject = {
    localId,
    cloudId: null,
    name: name ?? DEFAULT_PROJECT_NAME,
    visibility: 'private',
    createdAt: now,
    localSavedAt: now,
    cloudSavedAt: null,
    ownerToken: null,
    state: initialState,
  };
  saveProject(project);
  return localId;
}

/** Delete a project from localStorage and manifest */
export function deleteProject(localId: string): void {
  // Remove from localStorage
  localStorage.removeItem(projectStorageKey(localId));

  // Update manifest
  const manifest = loadManifest();
  manifest.projects = manifest.projects.filter(p => p.localId !== localId);
  saveManifest(manifest);
}

/** Patch only the state (and optionally name) of a project without a full read-parse cycle.
 *  Reads the raw JSON, patches state/name/timestamp, writes back, and updates manifest cache. */
export function patchProjectState(localId: string, state: SerializedAppState, name?: string): void {
  const key = projectStorageKey(localId);
  const raw = localStorage.getItem(key);
  if (!raw) return;

  try {
    const project: StoredLocalProject = JSON.parse(raw);
    project.state = state;
    if (name !== undefined) {
      project.name = name;
    }
    const now = new Date().toISOString();
    project.localSavedAt = now;
    localStorage.setItem(key, JSON.stringify(project));

    // Update manifest timestamp in cache
    const manifest = loadManifest();
    const idx = manifest.projects.findIndex(p => p.localId === localId);
    if (idx >= 0) {
      manifest.projects[idx].localSavedAt = now;
      if (name !== undefined) {
        manifest.projects[idx].name = name;
      }
      saveManifest(manifest);
    }
  } catch {
    // Corrupt data — skip
  }
}

/** Update metadata fields on a project (name, cloudId, visibility, etc.) */
export function updateProjectMetadata(
  localId: string,
  updates: Partial<Pick<StoredLocalProject, 'name' | 'cloudId' | 'visibility' | 'cloudSavedAt' | 'ownerToken'>>,
): void {
  const project = loadProject(localId);
  if (!project) return;
  Object.assign(project, updates);
  saveProject(project);
}

/** Get the most recently saved project's localId.
 *  Accepts an optional manifest to avoid redundant loads when the caller already has one. */
export function getMostRecentProjectId(manifest?: ProjectManifest): string | null {
  const m = manifest ?? loadManifest();
  if (m.projects.length === 0) return null;
  const sorted = [...m.projects].sort(
    (a, b) => new Date(b.localSavedAt).getTime() - new Date(a.localSavedAt).getTime(),
  );
  return sorted[0].localId;
}

/** Estimate localStorage usage */
export function getStorageUsage(): { usedBytes: number; estimatedTotalBytes: number; percent: number } {
  let usedBytes = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key) {
      const value = localStorage.getItem(key);
      // Each char is roughly 2 bytes in UTF-16
      usedBytes += (key.length + (value?.length ?? 0)) * 2;
    }
  }
  const estimatedTotalBytes = 5 * 1024 * 1024; // 5MB typical limit
  return {
    usedBytes,
    estimatedTotalBytes,
    percent: Math.round((usedBytes / estimatedTotalBytes) * 100),
  };
}

const CLOUD_PROJECTS_KEY = 'register-viewer-cloud-projects';

/** Migrate legacy single-project state into a manifest project entry. */
function migrateLegacyState(): void {
  if (localStorage.getItem(MANIFEST_KEY)) return;
  const legacyState = localStorage.getItem(LEGACY_STATE_KEY);
  if (!legacyState) return;
  try {
    const parsed = JSON.parse(legacyState) as SerializedAppState;
    createProject(parsed, parsed.project?.title ?? DEFAULT_PROJECT_NAME);
  } catch {
    // Corrupt legacy data — start fresh
  }
}

/**
 * Migrate ownerTokens from legacy cloud-projects records into StoredLocalProject records.
 * Reads from either the original key ('register-viewer-projects') or the intermediate
 * key ('register-viewer-cloud-projects') — whichever exists — then cleans up both.
 */
function migrateOwnerTokensToProjects(): void {
  const raw = localStorage.getItem(LEGACY_PROJECTS_KEY)
    ?? localStorage.getItem(CLOUD_PROJECTS_KEY);
  if (!raw) return;
  try {
    const records = JSON.parse(raw) as Array<{ id: string; ownerToken: string }>;
    if (Array.isArray(records)) {
      const manifest = loadManifest();
      for (const record of records) {
        if (!record.id || !record.ownerToken) continue;
        const entry = manifest.projects.find(p => p.cloudId === record.id);
        if (!entry) continue;
        const project = loadProject(entry.localId);
        if (project && !project.ownerToken) {
          project.ownerToken = record.ownerToken;
          localStorage.setItem(projectStorageKey(project.localId), JSON.stringify(project));
        }
      }
    }
  } catch {
    // Corrupt data — skip
  }
  localStorage.removeItem(CLOUD_PROJECTS_KEY);
}

/** Run migration from legacy storage format. Call once on startup. */
export function runMigrationIfNeeded(): void {
  migrateLegacyState();
  migrateOwnerTokensToProjects();

  // Clean up legacy keys unconditionally.
  // Note: LEGACY_TOKEN_KEY ('register-viewer-owner-token') is NOT removed
  // because getOrCreateOwnerToken() actively uses that key for cloud auth.
  localStorage.removeItem(LEGACY_STATE_KEY);
  localStorage.removeItem(LEGACY_PROJECTS_KEY);

  // Ensure a manifest exists even if no migration happened
  if (!localStorage.getItem(MANIFEST_KEY)) {
    saveManifest({ version: 1, projects: [] });
  }

  // Run orphan recovery once at startup (not on every loadManifest call)
  const manifest = loadManifest();
  const before = manifest.projects.length;
  recoverOrphanedProjects(manifest);
  if (manifest.projects.length !== before) {
    saveManifest(manifest);
  }
}
