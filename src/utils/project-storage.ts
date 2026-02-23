import type {
  ProjectManifest,
  ProjectManifestEntry,
  StoredLocalProject,
  ProjectListEntry,
} from '../types/project';
import type { SerializedAppState } from '../types/register';

const MANIFEST_KEY = 'register-viewer-manifest';
const PROJECT_PREFIX = 'register-viewer-project:';
const LEGACY_STATE_KEY = 'register-viewer-state';
const LEGACY_PROJECTS_KEY = 'register-viewer-projects';

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

/** Load the project manifest, running orphan recovery */
export function loadManifest(): ProjectManifest {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    if (!raw) {
      const empty: ProjectManifest = { version: 1, projects: [] };
      return recoverOrphanedProjects(empty);
    }
    const parsed = JSON.parse(raw) as ProjectManifest;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) {
      return recoverOrphanedProjects({ version: 1, projects: [] });
    }
    return recoverOrphanedProjects(parsed);
  } catch {
    return recoverOrphanedProjects({ version: 1, projects: [] });
  }
}

/** Save the manifest to localStorage */
export function saveManifest(manifest: ProjectManifest): void {
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(manifest));
}

/** Load a single project by localId */
export function loadProject(localId: string): StoredLocalProject | null {
  try {
    const raw = localStorage.getItem(projectStorageKey(localId));
    if (!raw) return null;
    return JSON.parse(raw) as StoredLocalProject;
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
    name: name ?? 'Untitled Project',
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

/** Get the most recently saved project's localId */
export function getMostRecentProjectId(): string | null {
  const manifest = loadManifest();
  if (manifest.projects.length === 0) return null;
  const sorted = [...manifest.projects].sort(
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

/** Run migration from legacy storage format. Call once on startup. */
export function runMigrationIfNeeded(): void {
  const existingManifest = localStorage.getItem(MANIFEST_KEY);

  // Migrate legacy state only if no manifest exists yet
  if (!existingManifest) {
    const legacyState = localStorage.getItem(LEGACY_STATE_KEY);
    if (legacyState) {
      try {
        const parsed = JSON.parse(legacyState) as SerializedAppState;
        const name = parsed.project?.title ?? 'Untitled Project';
        createProject(parsed, name);
      } catch {
        // Corrupt legacy data — start fresh
      }
    }
  }

  // Migrate cloud ownership records from legacy key to new key if needed.
  // The old key 'register-viewer-projects' collided with the legacy cleanup,
  // so cloud ownership records now live under 'register-viewer-cloud-projects'.
  const CLOUD_PROJECTS_KEY = 'register-viewer-cloud-projects';
  if (!localStorage.getItem(CLOUD_PROJECTS_KEY)) {
    const legacyProjects = localStorage.getItem(LEGACY_PROJECTS_KEY);
    if (legacyProjects) {
      try {
        const parsed = JSON.parse(legacyProjects);
        if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].ownerToken) {
          localStorage.setItem(CLOUD_PROJECTS_KEY, legacyProjects);
        }
      } catch {
        // Corrupt data — discard
      }
    }
  }

  // Clean up legacy keys unconditionally (even if manifest already exists).
  // Note: LEGACY_TOKEN_KEY ('register-viewer-owner-token') is NOT removed here
  // because getOrCreateOwnerToken() actively uses that key for cloud auth.
  localStorage.removeItem(LEGACY_STATE_KEY);
  localStorage.removeItem(LEGACY_PROJECTS_KEY);

  // Ensure a manifest exists even if no migration happened
  if (!localStorage.getItem(MANIFEST_KEY)) {
    saveManifest({ version: 1, projects: [] });
  }
}
