import {
  DEFAULT_PROJECT_NAME,
  type ProjectManifest,
  type ProjectManifestEntry,
  type StoredLocalProject,
  type StoredUnsavedProject,
  type ProjectListEntry,
  type UnsavedProjectSource,
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
const UNSAVED_PROJECT_KEY = 'register-viewer-unsaved';
export const UNSAVED_SESSION_SENTINEL = '__unsaved__';

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
    serverVersion: project.serverVersion ?? null,
    cloudConflictVersion: project.cloudConflictVersion ?? null,
    storage: project.storage ?? 'local',
  };
}

/** Convert a ProjectManifestEntry to a ProjectListEntry (UI view, no secrets) */
export function toProjectListEntry(entry: ProjectManifestEntry): ProjectListEntry {
  return {
    ...entry,
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
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[project-storage] Failed to recover orphaned project:', localId, err);
      }
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
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[project-storage] Failed to parse manifest from localStorage:', err);
      }
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
    (p.cloudId === null || typeof p.cloudId === 'string') &&
    typeof p.createdAt === 'string' &&
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
    // Backfill or correct storage for pre-migration records
    if (parsed.storage !== 'local' && parsed.storage !== 'cloud') {
      parsed.storage = parsed.cloudId ? 'cloud' : 'local';
    }
    return parsed;
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[project-storage] Failed to load project:', localId, err);
    }
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

/**
 * Optional cloud metadata for creating a project that is already cloud-linked.
 * Used by `syncCloudProjects` to create lightweight local placeholders (cloud-only stubs)
 * for server projects that have no local counterpart. These stubs use `EMPTY_SERIALIZED_STATE`
 * as their initial state; actual project data is fetched lazily when the user opens the project.
 */
interface CreateProjectCloudMeta {
  cloudId: string;
  visibility: import('../types/project').Visibility;
  cloudSavedAt: string;
  serverVersion?: number | null;
  storage?: 'local' | 'cloud';
}

/** Create a new project with initial state, returns the localId */
export function createProject(initialState: SerializedAppState, name?: string, cloudMeta?: CreateProjectCloudMeta): string {
  const localId = generateLocalId();
  const now = new Date().toISOString();
  const project: StoredLocalProject = {
    localId,
    cloudId: cloudMeta?.cloudId ?? null,
    name: name ?? DEFAULT_PROJECT_NAME,
    visibility: cloudMeta?.visibility ?? 'private',
    createdAt: now,
    localSavedAt: now,
    cloudSavedAt: cloudMeta?.cloudSavedAt ?? null,
    serverVersion: cloudMeta?.serverVersion ?? null,
    cloudConflictVersion: null,
    storage: cloudMeta?.storage ?? 'local',
    state: initialState,
  };
  saveProject(project);
  return localId;
}

/** Delete a project from localStorage and manifest */
export function deleteProject(localId: string): void {
  // Remove from localStorage
  evictProjectData(localId);

  // Update manifest
  const manifest = loadManifest();
  manifest.projects = manifest.projects.filter(p => p.localId !== localId);
  saveManifest(manifest);
}

/** Patch the state of a project without a full read-parse cycle.
 *  Derives the manifest name from state.project.title (single source of truth).
 *  Reads the raw JSON, patches state/name/timestamp, writes back, and updates manifest cache. */
export function patchProjectState(localId: string, state: SerializedAppState): void {
  const key = projectStorageKey(localId);
  const raw = localStorage.getItem(key);
  if (!raw) return;

  try {
    const project: StoredLocalProject = JSON.parse(raw);
    const now = new Date().toISOString();
    const name = state.project?.title?.trim() || project.name;
    const updated: StoredLocalProject = {
      ...project,
      state,
      name,
      localSavedAt: now,
    };
    localStorage.setItem(key, JSON.stringify(updated));

    // Update manifest in cache
    const manifest = loadManifest();
    const idx = manifest.projects.findIndex(p => p.localId === localId);
    if (idx >= 0) {
      manifest.projects[idx].localSavedAt = now;
      manifest.projects[idx].name = name;
      saveManifest(manifest);
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[project-storage] Failed to patch project state:', localId, err);
    }
  }
}

/**
 * Persist a saved project's latest in-memory state through the full project
 * record path so cloud metadata such as serverVersion is preserved.
 */
export function flushProjectState(localId: string, state: SerializedAppState): StoredLocalProject | null {
  const project = loadProject(localId);
  if (!project) return null;

  const name = state.project?.title?.trim() || project.name;
  if (name === project.name && JSON.stringify(state) === JSON.stringify(project.state)) {
    return project;
  }

  const updated: StoredLocalProject = {
    ...project,
    state,
    name,
  };
  saveProject(updated);
  return loadProject(localId) ?? updated;
}

/** Update metadata fields on a project (name, cloudId, visibility, etc.) */
export function updateProjectMetadata(
  localId: string,
  updates: Partial<Pick<StoredLocalProject, 'name' | 'cloudId' | 'visibility' | 'cloudSavedAt' | 'storage' | 'serverVersion' | 'cloudConflictVersion'>>,
): void {
  const project = loadProject(localId);
  if (!project) return;
  saveProject({ ...project, ...updates });
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

/** Purge all cloud-backed projects from localStorage. Returns purged localIds. */
export function purgeCloudProjects(): string[] {
  const manifest = loadManifest();
  const purged: string[] = [];
  const kept: ProjectManifestEntry[] = [];

  for (const entry of manifest.projects) {
    if (entry.storage === 'cloud') {
      evictProjectData(entry.localId);
      purged.push(entry.localId);
    } else {
      kept.push(entry);
    }
  }

  saveManifest({ ...manifest, projects: kept });
  return purged;
}

/** Check if a project has full data in localStorage (not just a manifest stub). */
export function hasLocalData(localId: string): boolean {
  return localStorage.getItem(projectStorageKey(localId)) !== null;
}

/** Remove per-project localStorage key but keep manifest entry (convert to stub). */
export function evictProjectData(localId: string): void {
  localStorage.removeItem(projectStorageKey(localId));
}

/**
 * Evict the least-recently-used cloud project's data from localStorage.
 * Used for quota pressure — only evicts storage:'cloud' projects (they can
 * be re-fetched). Manifest entry stays so the project still appears in the list.
 * Uses localSavedAt as LRU proxy (best available — no lastViewedAt field).
 *
 * Note: loadManifest() uses an in-memory cache — no JSON.parse on repeated calls.
 */
export function evictLeastRecentCloudProject(excludeLocalId: string | null): boolean {
  const manifest = loadManifest();
  const candidates = manifest.projects
    .filter(p => p.storage === 'cloud' && p.localId !== excludeLocalId && hasLocalData(p.localId))
    .sort((a, b) => (a.localSavedAt ?? '').localeCompare(b.localSavedAt ?? ''));
  if (candidates.length === 0) return false;
  evictProjectData(candidates[0].localId);
  return true;
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

// ---------------------------------------------------------------------------
// Unsaved project utilities
// ---------------------------------------------------------------------------

/** Persist an unsaved project to localStorage. */
export function saveUnsavedProjectState(
  name: string,
  state: SerializedAppState,
  source: UnsavedProjectSource = 'new',
  createdAt?: string,
): void {
  const record: StoredUnsavedProject = {
    name,
    state,
    createdAt: createdAt ?? new Date().toISOString(),
    source,
  };
  localStorage.setItem(UNSAVED_PROJECT_KEY, JSON.stringify(record));
}

/** Load the unsaved project from localStorage. Returns null if missing or corrupt. */
export function loadUnsavedProject(): StoredUnsavedProject | null {
  try {
    const raw = localStorage.getItem(UNSAVED_PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof parsed.name !== 'string' ||
      typeof parsed.state !== 'object' || parsed.state === null ||
      !Array.isArray(parsed.state.registers)
    ) {
      return null;
    }
    return parsed as StoredUnsavedProject;
  } catch {
    return null;
  }
}

/** Remove the unsaved project key from localStorage. */
export function clearUnsavedProject(): void {
  localStorage.removeItem(UNSAVED_PROJECT_KEY);
}

/** Migrate legacy single-project state into a manifest project entry. */
function migrateLegacyState(): void {
  if (localStorage.getItem(MANIFEST_KEY)) return;
  const legacyState = localStorage.getItem(LEGACY_STATE_KEY);
  if (!legacyState) return;
  try {
    const parsed = JSON.parse(legacyState) as SerializedAppState;
    createProject(parsed, parsed.project?.title ?? DEFAULT_PROJECT_NAME);
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[project-storage] Failed to migrate legacy state:', err);
    }
  }
}

/**
 * Run migration from legacy storage format. Call once on startup.
 *
 * Migration steps (idempotent):
 * 1. Convert legacy single-project state to manifest format
 * 2. Remove legacy localStorage keys
 * 3. Ensure manifest exists
 * 4. Backfill `storage` field for pre-existing manifest entries (cloud if cloudId, local otherwise)
 * 5. Recover orphaned project keys not tracked in the manifest
 */
export function runMigrationIfNeeded(): void {
  migrateLegacyState();

  // Clean up legacy keys unconditionally.
  localStorage.removeItem(LEGACY_STATE_KEY);
  localStorage.removeItem(LEGACY_PROJECTS_KEY);
  localStorage.removeItem('register-viewer-cloud-projects');
  localStorage.removeItem('register-viewer-owner-token');

  // Ensure a manifest exists even if no migration happened
  if (!localStorage.getItem(MANIFEST_KEY)) {
    saveManifest({ version: 1, projects: [] });
  }

  // Backfill storage field for manifests created before this field existed
  const preOrphanManifest = loadManifest();
  let needsSave = false;
  for (const entry of preOrphanManifest.projects) {
    // Cast to partial — old localStorage data may lack or have invalid `storage`
    const s = (entry as Partial<ProjectManifestEntry>).storage;
    if (s !== 'local' && s !== 'cloud') {
      entry.storage = entry.cloudId !== null ? 'cloud' : 'local';
      needsSave = true;
    }
  }
  if (needsSave) saveManifest(preOrphanManifest);

  // Run orphan recovery once at startup (not on every loadManifest call)
  const manifest = loadManifest();
  const before = manifest.projects.length;
  recoverOrphanedProjects(manifest);
  if (manifest.projects.length !== before) {
    saveManifest(manifest);
  }
}
