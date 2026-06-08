import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadManifest,
  saveManifest,
  loadProject,
  saveProject,
  createProject,
  deleteProject,
  patchProjectState,
  updateProjectMetadata,
  flushProjectState,
  getMostRecentProjectId,
  getStorageUsage,
  runMigrationIfNeeded,
  toProjectListEntry,
  projectStorageKey,
  invalidateManifestCache,
  purgeCloudProjects,
  hasLocalData,
  evictProjectData,
  evictLeastRecentCloudProject,
} from './project-storage';
import { DEFAULT_PROJECT_NAME, type StoredLocalProject, type ProjectManifest, type ProjectManifestEntry } from '../types/project';
import type { SerializedAppState } from '../types/register';

function makeSerializedState(overrides?: Partial<SerializedAppState>): SerializedAppState {
  return {
    registers: [],
    activeRegisterId: null,
    registerValues: {},
    ...overrides,
  };
}

function makeStoredProject(overrides?: Partial<StoredLocalProject>): StoredLocalProject {
  return {
    localId: 'test-id-1',
    cloudId: null,
    name: 'Test Project',
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    localSavedAt: '2026-01-01T00:00:00.000Z',
    cloudSavedAt: null,
    serverVersion: null,
    storage: 'local',
    state: makeSerializedState(),
    ...overrides,
  };
}

function setProjectSavedAt(localId: string, localSavedAt: string): void {
  const project = loadProject(localId)!;
  localStorage.setItem(projectStorageKey(localId), JSON.stringify({ ...project, localSavedAt }));
  const manifest = loadManifest();
  const entry = manifest.projects.find(p => p.localId === localId)!;
  entry.localSavedAt = localSavedAt;
  saveManifest(manifest);
}

function mockProjectSetItemFailures(error: unknown, failures = Number.POSITIVE_INFINITY) {
  const originalSetItem = Storage.prototype.setItem;
  let remaining = failures;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('register-viewer-project:') && remaining > 0) {
      remaining--;
      throw error;
    }
    return originalSetItem.call(this, key, value);
  });
}

function mockManifestSetItemFailures(error: unknown, failures = Number.POSITIVE_INFINITY) {
  const originalSetItem = Storage.prototype.setItem;
  let remaining = failures;
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key === 'register-viewer-manifest' && remaining > 0) {
      remaining--;
      throw error;
    }
    return originalSetItem.call(this, key, value);
  });
}

function quotaError(): DOMException {
  return new DOMException('quota exceeded', 'QuotaExceededError');
}

function securityError(): DOMException {
  return new DOMException('access denied', 'SecurityError');
}

function mockAllGetItemFailures(error: unknown) {
  return vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw error;
  });
}

beforeEach(() => {
  localStorage.clear();
  invalidateManifestCache();
  vi.restoreAllMocks();
});

describe('projectStorageKey', () => {
  it('returns prefixed key', () => {
    expect(projectStorageKey('abc-123')).toBe('register-viewer-project:abc-123');
  });
});

describe('loadManifest', () => {
  it('returns empty manifest when nothing exists', () => {
    const manifest = loadManifest();
    expect(manifest).toEqual({ version: 1, projects: [] });
  });

  it('parses a valid manifest', () => {
    const stored: ProjectManifest = {
      version: 1,
      projects: [{
        localId: 'id-1',
        cloudId: null,
        name: 'Project 1',
        visibility: 'private',
        createdAt: '2026-01-01T00:00:00.000Z',
        localSavedAt: '2026-01-01T00:00:00.000Z',
        cloudSavedAt: null,
        storage: 'local',
      }],
    };
    localStorage.setItem('register-viewer-manifest', JSON.stringify(stored));
    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].localId).toBe('id-1');
  });

  it('recovers orphaned projects not in manifest (via runMigrationIfNeeded)', () => {
    // Save a manifest with no projects
    saveManifest({ version: 1, projects: [] });

    // Write an orphaned project directly to localStorage
    const orphan = makeStoredProject({ localId: 'orphan-1', name: 'Orphan' });
    localStorage.setItem('register-viewer-project:orphan-1', JSON.stringify(orphan));

    // Orphan recovery now only runs at startup via runMigrationIfNeeded
    invalidateManifestCache();
    runMigrationIfNeeded();
    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].localId).toBe('orphan-1');
    expect(manifest.projects[0].name).toBe('Orphan');
  });

  it('does not duplicate projects already in manifest', () => {
    const project = makeStoredProject({ localId: 'id-1' });
    localStorage.setItem('register-viewer-project:id-1', JSON.stringify(project));

    const manifestData: ProjectManifest = {
      version: 1,
      projects: [{
        localId: 'id-1',
        cloudId: null,
        name: 'Test Project',
        visibility: 'private',
        createdAt: '2026-01-01T00:00:00.000Z',
        localSavedAt: '2026-01-01T00:00:00.000Z',
        cloudSavedAt: null,
        storage: 'local',
      }],
    };
    localStorage.setItem('register-viewer-manifest', JSON.stringify(manifestData));

    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
  });

  it('handles corrupt manifest JSON gracefully', () => {
    localStorage.setItem('register-viewer-manifest', '{not valid json');
    const manifest = loadManifest();
    expect(manifest).toEqual({ version: 1, projects: [] });
  });

  it('handles manifest with wrong version', () => {
    localStorage.setItem('register-viewer-manifest', JSON.stringify({ version: 99, projects: [] }));
    const manifest = loadManifest();
    expect(manifest).toEqual({ version: 1, projects: [] });
  });

  it('handles manifest with missing projects array', () => {
    localStorage.setItem('register-viewer-manifest', JSON.stringify({ version: 1 }));
    const manifest = loadManifest();
    expect(manifest).toEqual({ version: 1, projects: [] });
  });

  it('recovers orphans created after manifest was last saved (simulates crash)', () => {
    // Create a project normally
    const id1 = createProject(makeSerializedState(), 'Normal');

    // Simulate crash: write project key directly without updating manifest
    const orphan = makeStoredProject({ localId: 'crashed-orphan', name: 'Crashed During Save' });
    localStorage.setItem(projectStorageKey('crashed-orphan'), JSON.stringify(orphan));

    // Orphan recovery now only runs at startup via runMigrationIfNeeded
    invalidateManifestCache();
    runMigrationIfNeeded();
    const manifest = loadManifest();
    expect(manifest.projects.some(p => p.localId === id1)).toBe(true);
    expect(manifest.projects.some(p => p.localId === 'crashed-orphan')).toBe(true);
    expect(manifest.projects).toHaveLength(2);
  });

  it('skips corrupt orphaned project data', () => {
    saveManifest({ version: 1, projects: [] });
    localStorage.setItem('register-viewer-project:bad', '{corrupt');
    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(0);
  });
});

describe('saveManifest', () => {
  it('writes manifest to localStorage', () => {
    const manifest: ProjectManifest = { version: 1, projects: [] };
    saveManifest(manifest);
    const raw = localStorage.getItem('register-viewer-manifest');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual(manifest);
  });
});

describe('loadProject', () => {
  it('returns null when project does not exist', () => {
    expect(loadProject('nonexistent')).toBeNull();
  });

  it('retrieves a saved project', () => {
    const project = makeStoredProject();
    localStorage.setItem('register-viewer-project:test-id-1', JSON.stringify(project));
    const loaded = loadProject('test-id-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.name).toBe('Test Project');
    expect(loaded!.localId).toBe('test-id-1');
  });

  it('returns null for corrupt project JSON', () => {
    localStorage.setItem('register-viewer-project:bad', '{corrupt');
    expect(loadProject('bad')).toBeNull();
  });
});

describe('saveProject', () => {
  it('writes project key first, then manifest', () => {
    const setItemCalls: string[] = [];
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
      setItemCalls.push(key);
      originalSetItem.call(this, key, value);
    };

    try {
      const project = makeStoredProject();
      saveProject(project);

      // Project key should be written before manifest
      const projectKeyIndex = setItemCalls.indexOf('register-viewer-project:test-id-1');
      const manifestIndex = setItemCalls.indexOf('register-viewer-manifest');
      expect(projectKeyIndex).toBeGreaterThanOrEqual(0);
      expect(manifestIndex).toBeGreaterThanOrEqual(0);
      expect(projectKeyIndex).toBeLessThan(manifestIndex);
    } finally {
      Storage.prototype.setItem = originalSetItem;
    }
  });

  it('updates localSavedAt timestamp', () => {
    const project = makeStoredProject({ localSavedAt: '2020-01-01T00:00:00.000Z' });
    saveProject(project);
    const loaded = loadProject('test-id-1');
    expect(loaded!.localSavedAt).not.toBe('2020-01-01T00:00:00.000Z');
  });

  it('adds new entry to manifest if not present', () => {
    saveManifest({ version: 1, projects: [] });
    const project = makeStoredProject();
    saveProject(project);
    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].localId).toBe('test-id-1');
  });

  it('updates existing entry in manifest', () => {
    const project = makeStoredProject();
    saveProject(project);

    project.name = 'Updated Name';
    saveProject(project);

    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].name).toBe('Updated Name');
  });

  it('persists serverVersion into the manifest entry', () => {
    const project = makeStoredProject({
      cloudId: 'cloud-1',
      storage: 'cloud',
      serverVersion: 7,
    });

    saveProject(project);

    const manifest = loadManifest();
    expect(manifest.projects[0].serverVersion).toBe(7);
  });
});

describe('createProject', () => {
  it('creates project with default name', () => {
    const localId = createProject(makeSerializedState());
    expect(localId).toBeTruthy();
    const project = loadProject(localId);
    expect(project).not.toBeNull();
    expect(project!.name).toBe(DEFAULT_PROJECT_NAME);
    expect(project!.visibility).toBe('private');
    expect(project!.cloudId).toBeNull();
  });

  it('creates project with custom name', () => {
    const localId = createProject(makeSerializedState(), 'My Registers');
    const project = loadProject(localId);
    expect(project!.name).toBe('My Registers');
  });

  it('adds entry to manifest', () => {
    const localId = createProject(makeSerializedState());
    const manifest = loadManifest();
    expect(manifest.projects.some(p => p.localId === localId)).toBe(true);
  });

  it('stores the initial state', () => {
    const state = makeSerializedState({ mapTableWidth: 16 });
    const localId = createProject(state);
    const project = loadProject(localId);
    expect(project!.state.mapTableWidth).toBe(16);
  });

  it('creates cloud placeholders with serverVersion', () => {
    const localId = createProject(makeSerializedState(), 'Cloud', {
      cloudId: 'cloud-1',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      serverVersion: 4,
      storage: 'cloud',
    });

    const project = loadProject(localId);
    const entry = loadManifest().projects.find(p => p.localId === localId);
    expect(project!.serverVersion).toBe(4);
    expect(entry!.serverVersion).toBe(4);
  });
});

describe('deleteProject', () => {
  it('removes project from localStorage', () => {
    const localId = createProject(makeSerializedState());
    expect(loadProject(localId)).not.toBeNull();
    deleteProject(localId);
    expect(loadProject(localId)).toBeNull();
  });

  it('removes entry from manifest', () => {
    const localId = createProject(makeSerializedState());
    deleteProject(localId);
    const manifest = loadManifest();
    expect(manifest.projects.some(p => p.localId === localId)).toBe(false);
  });

  it('does not throw when deleting nonexistent project', () => {
    expect(() => deleteProject('nonexistent')).not.toThrow();
  });
});

describe('updateProjectMetadata', () => {
  it('updates name', () => {
    const localId = createProject(makeSerializedState(), 'Old Name');
    updateProjectMetadata(localId, { name: 'New Name' });
    const project = loadProject(localId);
    expect(project!.name).toBe('New Name');
  });

  it('updates cloudId and cloudSavedAt for owned cloud projects', () => {
    const localId = createProject(makeSerializedState());
    updateProjectMetadata(localId, {
      cloudId: 'abc123def456',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const project = loadProject(localId);
    expect(project!.cloudId).toBe('abc123def456');
    expect(project!.cloudSavedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(project!.storage).toBe('cloud');
  });

  it('does not persist cloud identity when storage remains local', () => {
    const localId = createProject(makeSerializedState());

    updateProjectMetadata(localId, {
      cloudId: 'abc123def456',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      serverVersion: 3,
      cloudConflictVersion: 4,
      hasUnsyncedChanges: true,
    });

    const project = loadProject(localId);
    const entry = loadManifest().projects.find(p => p.localId === localId);
    expect(project).toMatchObject({
      storage: 'local',
      cloudId: null,
      visibility: 'private',
      cloudSavedAt: null,
      serverVersion: null,
      cloudConflictVersion: null,
    });
    expect(project!.hasUnsyncedChanges).toBeUndefined();
    expect(entry).toMatchObject({
      storage: 'local',
      cloudId: null,
      visibility: 'private',
      cloudSavedAt: null,
      serverVersion: null,
      cloudConflictVersion: null,
    });
    expect(entry!.hasUnsyncedChanges).toBeUndefined();
  });

  it('updates serverVersion in project and manifest metadata', () => {
    const localId = createProject(makeSerializedState(), 'Cloud Project', {
      cloudId: 'cloud-versioned',
      visibility: 'private',
      cloudSavedAt: '2026-01-01T00:00:00.000Z',
      storage: 'cloud',
    });
    updateProjectMetadata(localId, { serverVersion: 9 });

    const project = loadProject(localId);
    const entry = loadManifest().projects.find(p => p.localId === localId);
    expect(project!.serverVersion).toBe(9);
    expect(entry!.serverVersion).toBe(9);
  });

  it('does not rewrite storage for no-op metadata updates', () => {
    const localId = createProject(makeSerializedState(), 'No-op Project');
    const before = loadProject(localId);

    const result = updateProjectMetadata(localId, { visibility: before!.visibility });

    const after = loadProject(localId);
    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(true);
    expect(after!.localSavedAt).toBe(before!.localSavedAt);
  });

  it('can preserve localSavedAt for background metadata updates', () => {
    const localId = createProject(makeSerializedState(), 'Metadata Project', {
      cloudId: 'cloud-meta',
      visibility: 'private',
      cloudSavedAt: '2026-01-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const before = loadProject(localId);

    const result = updateProjectMetadata(localId, {
      visibility: 'unlisted',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
    }, { preserveLocalSavedAt: true });

    const project = loadProject(localId);
    const entry = loadManifest().projects.find(p => p.localId === localId);
    expect(result.ok).toBe(true);
    expect(result.unchanged).toBe(false);
    expect(project!.visibility).toBe('unlisted');
    expect(project!.cloudSavedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(project!.localSavedAt).toBe(before!.localSavedAt);
    expect(entry!.visibility).toBe('unlisted');
    expect(entry!.cloudSavedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(entry!.localSavedAt).toBe(before!.localSavedAt);
  });

  it('updates visibility', () => {
    const localId = createProject(makeSerializedState());
    updateProjectMetadata(localId, { visibility: 'unlisted' });
    const project = loadProject(localId);
    expect(project!.visibility).toBe('unlisted');
  });

  it('updates manifest entry as well', () => {
    const localId = createProject(makeSerializedState(), 'Old');
    updateProjectMetadata(localId, { name: 'New' });
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === localId);
    expect(entry!.name).toBe('New');
  });

  it('does nothing for nonexistent project', () => {
    expect(() => updateProjectMetadata('nonexistent', { name: 'X' })).not.toThrow();
  });
});

describe('flushProjectState', () => {
  it('updates state and preserves cloud metadata including serverVersion', () => {
    const localId = createProject(makeSerializedState({ registerValues: { reg1: '0x1' } }), 'Cloud', {
      cloudId: 'cloud-1',
      visibility: 'unlisted',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      serverVersion: 7,
      storage: 'cloud',
    });

    const flushed = flushProjectState(localId, makeSerializedState({
      registerValues: { reg1: '0x42' },
      project: { title: 'Renamed Cloud' } as SerializedAppState['project'],
    }));

    const stored = loadProject(localId);
    const entry = loadManifest().projects.find(p => p.localId === localId);
    expect(flushed.ok).toBe(true);
    expect(flushed.project!.state.registerValues).toEqual({ reg1: '0x42' });
    expect(stored!.cloudId).toBe('cloud-1');
    expect(stored!.visibility).toBe('unlisted');
    expect(stored!.cloudSavedAt).toBe('2026-02-01T00:00:00.000Z');
    expect(stored!.serverVersion).toBe(7);
    expect(stored!.name).toBe('Renamed Cloud');
    expect(entry!.serverVersion).toBe(7);
  });
});

describe('getMostRecentProjectId', () => {
  it('returns null when no projects exist', () => {
    expect(getMostRecentProjectId()).toBeNull();
  });

  it('returns the most recently saved project', () => {
    const id1 = createProject(makeSerializedState(), 'First');
    // Force a different timestamp by saving again
    const id2 = createProject(makeSerializedState(), 'Second');

    // The second project was created later, so it should be most recent
    const mostRecent = getMostRecentProjectId();
    // Both were just created so either could be most recent;
    // but id2 was created after id1 so its localSavedAt should be >= id1's
    expect([id1, id2]).toContain(mostRecent);
  });

  it('reflects updated save times', () => {
    const id1 = createProject(makeSerializedState(), 'Old');

    // Manually set id1's timestamp to the past
    const project1 = loadProject(id1)!;
    project1.localSavedAt = '2020-01-01T00:00:00.000Z';
    localStorage.setItem(projectStorageKey(id1), JSON.stringify(project1));
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === id1)!;
    entry.localSavedAt = '2020-01-01T00:00:00.000Z';
    saveManifest(manifest);

    const id2 = createProject(makeSerializedState(), 'New');
    expect(getMostRecentProjectId()).toBe(id2);
  });
});

describe('getStorageUsage', () => {
  it('returns usage information', () => {
    localStorage.setItem('test-key', 'test-value');
    const usage = getStorageUsage();
    expect(usage.usedBytes).toBeGreaterThan(0);
    expect(usage.estimatedTotalBytes).toBe(5 * 1024 * 1024);
    expect(usage.percent).toBeGreaterThanOrEqual(0);
    expect(usage.percent).toBeLessThanOrEqual(100);
  });

  it('returns zero when localStorage is empty', () => {
    const usage = getStorageUsage();
    expect(usage.usedBytes).toBe(0);
    expect(usage.percent).toBe(0);
  });
});

describe('runMigrationIfNeeded', () => {
  it('migrates legacy state to a project', () => {
    const legacyState = makeSerializedState({
      project: { title: 'My Legacy Project' } as SerializedAppState['project'],
    });
    localStorage.setItem('register-viewer-state', JSON.stringify(legacyState));

    runMigrationIfNeeded();

    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].name).toBe('My Legacy Project');

    // Legacy key should be removed
    expect(localStorage.getItem('register-viewer-state')).toBeNull();
  });

  it('uses default name when legacy state has no project title', () => {
    const legacyState = makeSerializedState();
    localStorage.setItem('register-viewer-state', JSON.stringify(legacyState));

    runMigrationIfNeeded();

    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].name).toBe(DEFAULT_PROJECT_NAME);
  });

  it('cleans up all legacy keys including owner token', () => {
    localStorage.setItem('register-viewer-state', JSON.stringify(makeSerializedState()));
    localStorage.setItem('register-viewer-projects', 'some-data');
    localStorage.setItem('register-viewer-owner-token', 'some-token');

    runMigrationIfNeeded();

    expect(localStorage.getItem('register-viewer-state')).toBeNull();
    expect(localStorage.getItem('register-viewer-projects')).toBeNull();
    // Owner token is now also removed
    expect(localStorage.getItem('register-viewer-owner-token')).toBeNull();
  });

  it('cleans up legacy keys even when no legacy state exists', () => {
    localStorage.setItem('register-viewer-projects', 'some-data');
    localStorage.setItem('register-viewer-owner-token', 'some-token');

    runMigrationIfNeeded();

    expect(localStorage.getItem('register-viewer-projects')).toBeNull();
    // Owner token is also removed
    expect(localStorage.getItem('register-viewer-owner-token')).toBeNull();
  });

  it('is idempotent — does not re-migrate if manifest exists, but still cleans legacy keys', () => {
    saveManifest({ version: 1, projects: [] });

    // Set legacy state that should NOT be migrated (manifest already exists)
    localStorage.setItem('register-viewer-state', JSON.stringify(makeSerializedState()));
    localStorage.setItem('register-viewer-projects', 'old-data');
    localStorage.setItem('register-viewer-owner-token', 'old-token');

    runMigrationIfNeeded();

    // Manifest should still be empty (migration was skipped)
    expect(loadManifest().projects).toHaveLength(0);
    // All legacy keys cleaned up
    expect(localStorage.getItem('register-viewer-state')).toBeNull();
    expect(localStorage.getItem('register-viewer-projects')).toBeNull();
    expect(localStorage.getItem('register-viewer-owner-token')).toBeNull();
  });

  it('creates empty manifest when no legacy data exists', () => {
    runMigrationIfNeeded();
    const manifest = loadManifest();
    expect(manifest).toEqual({ version: 1, projects: [] });
  });

  it('handles corrupt legacy state gracefully', () => {
    localStorage.setItem('register-viewer-state', '{not valid json');
    expect(() => runMigrationIfNeeded()).not.toThrow();
    expect(localStorage.getItem('register-viewer-state')).toBeNull();
    // Should still create a manifest
    expect(localStorage.getItem('register-viewer-manifest')).not.toBeNull();
  });

  it('does not throw when localStorage reads are blocked (disabled storage)', () => {
    // Simulates site-data/cookies disabled: every read throws SecurityError.
    mockAllGetItemFailures(securityError());

    expect(() => runMigrationIfNeeded()).not.toThrow();

    // With reads restored, the manifest degrades to the empty default.
    vi.restoreAllMocks();
    expect(loadManifest()).toEqual({ version: 1, projects: [] });
  });

  it('degrades to a no-op when the first-run seed write is blocked (quota/disabled)', () => {
    // No manifest exists, so runMigrationIfNeeded attempts the seed write.
    mockManifestSetItemFailures(quotaError());

    expect(() => runMigrationIfNeeded()).not.toThrow();
  });
});

describe('migration: storage field', () => {
  it('defaults legacy cloud-linked saved projects to local forks', () => {
    const legacyManifest = {
      version: 1,
      projects: [
        { localId: 'a', cloudId: 'abc123', name: 'Cloud', visibility: 'private', createdAt: '2026-01-01T00:00:00Z', localSavedAt: '2026-01-01T00:00:00Z', cloudSavedAt: '2026-01-01T00:00:00Z' },
        { localId: 'b', cloudId: null, name: 'Local', visibility: 'private', createdAt: '2026-01-01T00:00:00Z', localSavedAt: '2026-01-01T00:00:00Z', cloudSavedAt: null },
      ],
    };
    localStorage.setItem('register-viewer-manifest', JSON.stringify(legacyManifest));
    localStorage.setItem(projectStorageKey('a'), JSON.stringify(makeStoredProject({
      localId: 'a',
      cloudId: 'abc123',
      cloudSavedAt: '2026-01-01T00:00:00Z',
      serverVersion: 2,
      storage: 'local',
    })));

    runMigrationIfNeeded();

    const manifest = loadManifest();
    expect(manifest.projects[0]).toMatchObject({
      storage: 'local',
      cloudId: null,
      visibility: 'private',
      cloudSavedAt: null,
      serverVersion: null,
      cloudConflictVersion: null,
    });
    expect(manifest.projects[1].storage).toBe('local');
    const project = loadProject('a');
    expect(project).toMatchObject({
      storage: 'local',
      cloudId: null,
      cloudSavedAt: null,
      serverVersion: null,
      cloudConflictVersion: null,
    });
  });

  it('persists normalized manifest-only legacy cloud links', () => {
    const legacyManifest = {
      version: 1,
      projects: [
        {
          localId: 'manifest-only',
          cloudId: 'abc123',
          name: 'Manifest Only',
          visibility: 'unlisted',
          createdAt: '2026-01-01T00:00:00Z',
          localSavedAt: '2026-01-01T00:00:00Z',
          cloudSavedAt: '2026-01-01T00:00:00Z',
          serverVersion: 4,
          storage: 'local',
        },
      ],
    };
    localStorage.setItem('register-viewer-manifest', JSON.stringify(legacyManifest));

    runMigrationIfNeeded();

    const rawManifest = JSON.parse(localStorage.getItem('register-viewer-manifest')!) as ProjectManifest;
    expect(rawManifest.projects[0]).toMatchObject({
      storage: 'local',
      cloudId: null,
      visibility: 'private',
      cloudSavedAt: null,
      serverVersion: null,
      cloudConflictVersion: null,
    });
  });

  it('demotes cloud storage without a cloudId to a local project', () => {
    const project = makeStoredProject({
      localId: 'no-cloud-id',
      cloudId: null,
      storage: 'cloud',
      cloudSavedAt: '2026-01-01T00:00:00Z',
      serverVersion: 3,
      hasUnsyncedChanges: true,
    });
    localStorage.setItem(projectStorageKey('no-cloud-id'), JSON.stringify(project));
    saveManifest({
      version: 1,
      projects: [{
        localId: 'no-cloud-id',
        cloudId: null,
        name: 'No Cloud Id',
        visibility: 'unlisted',
        createdAt: '2026-01-01T00:00:00Z',
        localSavedAt: '2026-01-01T00:00:00Z',
        cloudSavedAt: '2026-01-01T00:00:00Z',
        serverVersion: 3,
        hasUnsyncedChanges: true,
        storage: 'cloud',
      }],
    });

    runMigrationIfNeeded();

    expect(loadProject('no-cloud-id')).toMatchObject({
      storage: 'local',
      cloudId: null,
      visibility: 'private',
      cloudSavedAt: null,
      serverVersion: null,
      cloudConflictVersion: null,
    });
    expect(loadProject('no-cloud-id')!.hasUnsyncedChanges).toBeUndefined();
  });
});

describe('purgeCloudProjects', () => {
  it('removes manifest entries and per-project keys for cloud-backed projects', () => {
    createProject(makeSerializedState(), 'Cloud 1', { cloudId: 'c1', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud' });
    createProject(makeSerializedState(), 'Cloud 2', { cloudId: 'c2', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud' });
    createProject(makeSerializedState(), 'Local Only');

    const { removed } = purgeCloudProjects();
    expect(removed).toHaveLength(2);

    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].name).toBe('Local Only');
  });

  it('only purges projects with storage=cloud', () => {
    // Create a cloud project (storage: 'cloud', cloudId: 'abc123')
    createProject(makeSerializedState(), 'Cloud Project', { cloudId: 'abc123', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud' });
    // Create a local project (storage: 'local')
    createProject(makeSerializedState(), 'Local Project');

    const { removed } = purgeCloudProjects();
    expect(removed).toHaveLength(1);

    // Assert only 1 project remains (the local one)
    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].name).toBe('Local Project');
    expect(manifest.projects[0].storage).toBe('local');
  });

  it('returns empty when no cloud projects exist', () => {
    createProject(makeSerializedState(), 'Local');
    const { removed, demoted } = purgeCloudProjects();
    expect(removed).toHaveLength(0);
    expect(demoted).toHaveLength(0);
    expect(loadManifest().projects).toHaveLength(1);
  });

  it('purgeCloudProjects demotes dirty/conflicted cloud projects to local and removes clean ones', () => {
    const clean = createProject(makeSerializedState(), 'Clean', { cloudId: 'c-clean', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud', serverVersion: 4, hasUnsyncedChanges: false });
    const dirty = createProject(makeSerializedState(), 'Dirty', { cloudId: 'c-dirty', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud', serverVersion: 7, hasUnsyncedChanges: true });
    const conflicted = createProject(makeSerializedState(), 'Conflicted', { cloudId: 'c-conf', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud', serverVersion: 2 });
    // Give conflicted a cloudConflictVersion by updating metadata
    updateProjectMetadata(conflicted, { cloudConflictVersion: 9 });

    const { removed, demoted } = purgeCloudProjects();

    expect(removed).toEqual([clean]);
    expect(demoted.sort()).toEqual([dirty, conflicted].sort());

    // Clean is gone entirely.
    expect(loadProject(clean)).toBeNull();
    expect(loadManifest().projects.some((p) => p.localId === clean)).toBe(false);

    // Dirty/conflicted survive as LOCAL projects with their data intact and cloud metadata cleared.
    for (const id of [dirty, conflicted]) {
      const record = loadProject(id);
      expect(record).not.toBeNull();
      expect(record!.storage).toBe('local');
      expect(record!.cloudId).toBeNull();
      const entry = loadManifest().projects.find((p) => p.localId === id)!;
      expect(entry.storage).toBe('local');
      expect(entry.cloudId).toBeNull();
    }
  });

  it('demoted entries preserve localSavedAt (demotion is not a user edit)', () => {
    const dirty = createProject(makeSerializedState(), 'Dirty', { cloudId: 'c-dirty', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud', serverVersion: 7, hasUnsyncedChanges: true });
    // Pin the localSavedAt to a known value
    setProjectSavedAt(dirty, '2024-06-01T00:00:00.000Z');

    purgeCloudProjects();

    const record = loadProject(dirty)!;
    expect(record).not.toBeNull();
    // Demotion must not update the timestamp (preserveLocalSavedAt: true)
    expect(record.localSavedAt).toBe('2024-06-01T00:00:00.000Z');
    const entry = loadManifest().projects.find((p) => p.localId === dirty)!;
    expect(entry.localSavedAt).toBe('2024-06-01T00:00:00.000Z');
  });

  it('keeps original manifest entry when record write fails during demotion', () => {
    const dirty = createProject(makeSerializedState(), 'Dirty', { cloudId: 'c-dirty', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud', serverVersion: 7, hasUnsyncedChanges: true });

    // Simulate a quota failure on the project record write (one failure, then succeeds).
    // After the write fails and there are no eviction candidates (the only cloud project
    // is the one being demoted, and it's protected by targetLocalId), saveProject returns
    // { ok: false } and purgeCloudProjects must keep the original manifest entry.
    mockProjectSetItemFailures(quotaError(), 1);

    const { demoted } = purgeCloudProjects();

    // Record write failed: the project must NOT appear in demoted
    expect(demoted).not.toContain(dirty);
    // The original manifest entry must still be present (cloud, not local)
    const entry = loadManifest().projects.find((p) => p.localId === dirty);
    expect(entry).toBeDefined();
    expect(entry!.storage).toBe('cloud');
    expect(entry!.cloudId).toBe('c-dirty');
  });
});

describe('hasLocalData', () => {
  it('returns true when per-project key exists', () => {
    const id = createProject(makeSerializedState(), 'Test');
    expect(hasLocalData(id)).toBe(true);
  });

  it('returns false when per-project key does not exist', () => {
    expect(hasLocalData('nonexistent')).toBe(false);
  });
});

describe('evictProjectData', () => {
  it('removes per-project localStorage key', () => {
    const id = createProject(makeSerializedState(), 'Test');
    expect(hasLocalData(id)).toBe(true);
    evictProjectData(id);
    expect(hasLocalData(id)).toBe(false);
  });

  it('does not throw for nonexistent project', () => {
    expect(() => evictProjectData('nonexistent')).not.toThrow();
  });
});

describe('toProjectListEntry', () => {
  it('converts manifest entry without cloud id', () => {
    const entry: ProjectManifestEntry = {
      localId: 'id-1',
      cloudId: null,
      name: 'Test',
      visibility: 'private',
      createdAt: '2026-01-01T00:00:00.000Z',
      localSavedAt: '2026-01-01T00:00:00.000Z',
      cloudSavedAt: null,
      storage: 'local',
    };
    const result = toProjectListEntry(entry);
    expect(result.storage).toBe('local');
    expect(result.localId).toBe('id-1');
    expect(result.name).toBe('Test');
  });

  it('converts manifest entry with cloud id', () => {
    const entry: ProjectManifestEntry = {
      localId: 'id-1',
      cloudId: 'abc123def456',
      name: 'Cloud Project',
      visibility: 'unlisted',
      createdAt: '2026-01-01T00:00:00.000Z',
      localSavedAt: '2026-01-01T00:00:00.000Z',
      cloudSavedAt: '2026-01-02T00:00:00.000Z',
      storage: 'cloud',
    };
    const result = toProjectListEntry(entry);
    expect(result.storage).toBe('cloud');
    expect(result.cloudId).toBe('abc123def456');
    expect(result.visibility).toBe('unlisted');
  });
});

describe('evictLeastRecentCloudProject', () => {
  it('evicts the oldest cloud project by localSavedAt', () => {
    const oldId = createProject(makeSerializedState(), 'Old Cloud', {
      cloudId: 'c-old', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud',
    });
    // Manually set old timestamp
    const oldProject = loadProject(oldId)!;
    oldProject.localSavedAt = '2020-01-01T00:00:00.000Z';
    localStorage.setItem(projectStorageKey(oldId), JSON.stringify(oldProject));
    const m1 = loadManifest();
    const e1 = m1.projects.find(p => p.localId === oldId)!;
    e1.localSavedAt = '2020-01-01T00:00:00.000Z';
    saveManifest(m1);

    const newId = createProject(makeSerializedState(), 'New Cloud', {
      cloudId: 'c-new', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud',
    });

    // Both projects have local data
    expect(hasLocalData(oldId)).toBe(true);
    expect(hasLocalData(newId)).toBe(true);

    const result = evictLeastRecentCloudProject(null);

    expect(result).toBe(true);
    // Oldest project's data should be evicted
    expect(hasLocalData(oldId)).toBe(false);
    // Newer project's data should remain
    expect(hasLocalData(newId)).toBe(true);
    // Manifest entry should still exist (just data evicted)
    const manifest = loadManifest();
    expect(manifest.projects.some(p => p.localId === oldId)).toBe(true);
  });

  it('skips the excluded project (active project)', () => {
    const activeId = createProject(makeSerializedState(), 'Active Cloud', {
      cloudId: 'c-active', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud',
    });
    // Set active project to very old timestamp
    const activeProject = loadProject(activeId)!;
    activeProject.localSavedAt = '2019-01-01T00:00:00.000Z';
    localStorage.setItem(projectStorageKey(activeId), JSON.stringify(activeProject));
    const m = loadManifest();
    const e = m.projects.find(p => p.localId === activeId)!;
    e.localSavedAt = '2019-01-01T00:00:00.000Z';
    saveManifest(m);

    const otherId = createProject(makeSerializedState(), 'Other Cloud', {
      cloudId: 'c-other', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud',
    });

    // Exclude the active project — should evict the other one instead
    const result = evictLeastRecentCloudProject(activeId);

    expect(result).toBe(true);
    expect(hasLocalData(activeId)).toBe(true); // excluded, not evicted
    expect(hasLocalData(otherId)).toBe(false); // evicted
  });

  it('returns false when no cloud project candidates exist', () => {
    // Only local projects
    createProject(makeSerializedState(), 'Local Only');

    const result = evictLeastRecentCloudProject(null);

    expect(result).toBe(false);
  });

  it('only evicts storage:cloud projects, not local ones', () => {
    const localId = createProject(makeSerializedState(), 'Local Project');
    // Set local project to very old timestamp
    const localProject = loadProject(localId)!;
    localProject.localSavedAt = '2018-01-01T00:00:00.000Z';
    localStorage.setItem(projectStorageKey(localId), JSON.stringify(localProject));
    const m = loadManifest();
    const e = m.projects.find(p => p.localId === localId)!;
    e.localSavedAt = '2018-01-01T00:00:00.000Z';
    saveManifest(m);

    const result = evictLeastRecentCloudProject(null);

    expect(result).toBe(false);
    expect(hasLocalData(localId)).toBe(true); // local project data preserved
  });
});

describe('quota-aware project writes', () => {
  it('retries a patched state write after evicting one cached cloud project', () => {
    const targetId = createProject(makeSerializedState({ project: { title: 'Target' } as SerializedAppState['project'] }), 'Target');
    const cachedId = createProject(makeSerializedState(), 'Cached Cloud', {
      cloudId: 'cloud-cached',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    setProjectSavedAt(cachedId, '2020-01-01T00:00:00.000Z');
    mockProjectSetItemFailures(quotaError(), 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Saved Target' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(true);
    expect(result.evictedLocalIds).toEqual([cachedId]);
    expect(loadProject(targetId)!.name).toBe('Saved Target');
    expect(hasLocalData(cachedId)).toBe(false);
    expect(loadManifest().projects.some(p => p.localId === cachedId)).toBe(true);
  });

  it('recognizes Firefox-style quota errors', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    const cachedId = createProject(makeSerializedState(), 'Cached Cloud', {
      cloudId: 'cloud-cached',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    mockProjectSetItemFailures({ name: 'NS_ERROR_DOM_QUOTA_REACHED', code: 1014 }, 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Changed Target' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(true);
    expect(result.evictedLocalIds).toEqual([cachedId]);
  });

  it('reports quota-exceeded without eviction when there is no eligible candidate', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    mockProjectSetItemFailures(quotaError());

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Unsaved' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe('quota-exceeded');
    expect(result.evictedLocalIds).toEqual([]);
    expect(loadProject(targetId)!.name).toBe('Target');
  });

  it('does not evict for non-quota storage errors', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    const cachedId = createProject(makeSerializedState(), 'Cached Cloud', {
      cloudId: 'cloud-cached',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    mockProjectSetItemFailures(new Error('disk failed'), 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Changed Target' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe('unknown-error');
    expect(result.evictedLocalIds).toEqual([]);
    expect(hasLocalData(cachedId)).toBe(true);
  });

  it('reports missing and corrupt project records without retrying', () => {
    const missing = patchProjectState('missing-id', makeSerializedState());
    expect(missing).toMatchObject({ ok: false, status: 'missing', evictedLocalIds: [] });

    localStorage.setItem(projectStorageKey('bad-id'), '{bad json');
    const corrupt = patchProjectState('bad-id', makeSerializedState());
    expect(corrupt).toMatchObject({ ok: false, status: 'corrupt', evictedLocalIds: [] });
  });

  it('excludes target, protected, local-only, and conflicted projects from quota eviction', () => {
    const targetId = createProject(makeSerializedState(), 'Target Cloud', {
      cloudId: 'cloud-target',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const protectedId = createProject(makeSerializedState(), 'Protected Cloud', {
      cloudId: 'cloud-protected',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const localId = createProject(makeSerializedState(), 'Local Only');
    const conflictedId = createProject(makeSerializedState(), 'Conflicted Cloud', {
      cloudId: 'cloud-conflicted',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    updateProjectMetadata(conflictedId, { cloudConflictVersion: 12 });
    const eligibleId = createProject(makeSerializedState(), 'Eligible Cloud', {
      cloudId: 'cloud-eligible',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });

    setProjectSavedAt(targetId, '2018-01-01T00:00:00.000Z');
    setProjectSavedAt(protectedId, '2019-01-01T00:00:00.000Z');
    setProjectSavedAt(localId, '2020-01-01T00:00:00.000Z');
    setProjectSavedAt(conflictedId, '2021-01-01T00:00:00.000Z');
    setProjectSavedAt(eligibleId, '2022-01-01T00:00:00.000Z');
    mockProjectSetItemFailures(quotaError(), 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Changed Target' } as SerializedAppState['project'],
    }), {
      protectedLocalIds: [protectedId],
    });

    expect(result.ok).toBe(true);
    expect(result.evictedLocalIds).toEqual([eligibleId]);
    expect(hasLocalData(targetId)).toBe(true);
    expect(hasLocalData(protectedId)).toBe(true);
    expect(hasLocalData(localId)).toBe(true);
    expect(hasLocalData(conflictedId)).toBe(true);
    expect(hasLocalData(eligibleId)).toBe(false);
  });

  it('does not evict cloud projects with unsynced local changes', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    const dirtyCloudId = createProject(makeSerializedState(), 'Dirty Cloud', {
      cloudId: 'dirty-cloud',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const cleanCloudId = createProject(makeSerializedState(), 'Clean Cloud', {
      cloudId: 'clean-cloud',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    patchProjectState(dirtyCloudId, makeSerializedState({
      project: { title: 'Dirty Cloud Edited' } as SerializedAppState['project'],
    }));
    setProjectSavedAt(dirtyCloudId, '2019-01-01T00:00:00.000Z');
    setProjectSavedAt(cleanCloudId, '2020-01-01T00:00:00.000Z');
    mockProjectSetItemFailures(quotaError(), 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Changed Target' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(true);
    expect(result.evictedLocalIds).toEqual([cleanCloudId]);
    expect(hasLocalData(dirtyCloudId)).toBe(true);
    expect(hasLocalData(cleanCloudId)).toBe(false);
    expect(loadManifest().projects.find(p => p.localId === dirtyCloudId)!.hasUnsyncedChanges).toBe(true);
  });

  it('does not mark a clean cloud project dirty for a no-op state patch', () => {
    const cloudId = createProject(makeSerializedState(), 'Clean Cloud', {
      cloudId: 'clean-cloud',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const before = loadProject(cloudId)!;

    const result = patchProjectState(cloudId, before.state);

    expect(result.ok).toBe(true);
    expect(loadProject(cloudId)!.hasUnsyncedChanges).toBe(false);
    expect(loadManifest().projects.find(p => p.localId === cloudId)!.hasUnsyncedChanges).toBe(false);
  });

  it('does not evict legacy cloud records without an explicit clean marker', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    const legacyId = createProject(makeSerializedState(), 'Legacy Clean Cloud', {
      cloudId: 'legacy-cloud',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const legacyProject = loadProject(legacyId)!;
    localStorage.setItem(projectStorageKey(legacyId), JSON.stringify({
      ...legacyProject,
      localSavedAt: '2026-01-01T00:00:00.000Z',
      hasUnsyncedChanges: undefined,
    }));
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === legacyId)!;
    entry.localSavedAt = '2026-01-01T00:00:00.000Z';
    entry.hasUnsyncedChanges = undefined;
    saveManifest(manifest);
    mockProjectSetItemFailures(quotaError(), 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Changed Target' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe('quota-exceeded');
    expect(result.evictedLocalIds).toEqual([]);
    expect(hasLocalData(legacyId)).toBe(true);
  });

  it('uses the stored dirty marker when manifest metadata is stale after a partial failure', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    const dirtyCloudId = createProject(makeSerializedState(), 'Dirty Cloud', {
      cloudId: 'dirty-cloud',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const cleanCloudId = createProject(makeSerializedState(), 'Clean Cloud', {
      cloudId: 'clean-cloud',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    const dirtyProject = loadProject(dirtyCloudId)!;
    localStorage.setItem(projectStorageKey(dirtyCloudId), JSON.stringify({
      ...dirtyProject,
      hasUnsyncedChanges: true,
    }));
    const manifest = loadManifest();
    manifest.projects.find(p => p.localId === dirtyCloudId)!.hasUnsyncedChanges = false;
    saveManifest(manifest);
    setProjectSavedAt(dirtyCloudId, '2020-01-01T00:00:00.000Z');
    setProjectSavedAt(cleanCloudId, '2021-01-01T00:00:00.000Z');
    mockProjectSetItemFailures(quotaError(), 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Changed Target' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(true);
    expect(result.evictedLocalIds).toEqual([cleanCloudId]);
    expect(hasLocalData(dirtyCloudId)).toBe(true);
    expect(hasLocalData(cleanCloudId)).toBe(false);
  });

  it('bounds quota eviction to three cached cloud projects', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    const cachedIds = [1, 2, 3, 4].map((n) => createProject(makeSerializedState(), `Cloud ${n}`, {
      cloudId: `cloud-${n}`,
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    }));
    cachedIds.forEach((id, index) => setProjectSavedAt(id, `2020-01-0${index + 1}T00:00:00.000Z`));
    mockProjectSetItemFailures(quotaError());

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Changed Target' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(false);
    expect(result.status).toBe('quota-exceeded');
    expect(result.evictedLocalIds).toEqual(cachedIds.slice(0, 3));
    expect(hasLocalData(cachedIds[3])).toBe(true);
  });

  it('uses the same quota recovery for full-record saves, metadata updates, and flushes', () => {
    const saveTarget = makeStoredProject({ localId: 'full-save-target', name: 'Full Save Target' });
    const saveCandidate = createProject(makeSerializedState(), 'Save Candidate', {
      cloudId: 'save-candidate',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    mockProjectSetItemFailures(quotaError(), 1);
    const saveResult = saveProject(saveTarget);
    expect(saveResult.ok).toBe(true);
    expect(saveResult.evictedLocalIds).toEqual([saveCandidate]);

    vi.restoreAllMocks();
    const metadataTarget = createProject(makeSerializedState(), 'Metadata Target');
    const metadataCandidate = createProject(makeSerializedState(), 'Metadata Candidate', {
      cloudId: 'metadata-candidate',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    mockProjectSetItemFailures(quotaError(), 1);
    const metadataResult = updateProjectMetadata(metadataTarget, { name: 'Metadata Updated' });
    expect(metadataResult.ok).toBe(true);
    expect(metadataResult.evictedLocalIds).toEqual([metadataCandidate]);
    expect(loadProject(metadataTarget)!.name).toBe('Metadata Updated');

    vi.restoreAllMocks();
    const flushTarget = createProject(makeSerializedState(), 'Flush Target');
    const flushCandidate = createProject(makeSerializedState(), 'Flush Candidate', {
      cloudId: 'flush-candidate',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    mockProjectSetItemFailures(quotaError(), 1);
    const flushResult = flushProjectState(flushTarget, makeSerializedState({
      project: { title: 'Flush Updated' } as SerializedAppState['project'],
    }));
    expect(flushResult.ok).toBe(true);
    expect(flushResult.evictedLocalIds).toEqual([flushCandidate]);
    expect(flushResult.project!.name).toBe('Flush Updated');
  });

  it('retries when quota is hit while writing the manifest', () => {
    const targetId = createProject(makeSerializedState(), 'Target');
    const cachedId = createProject(makeSerializedState(), 'Cached Cloud', {
      cloudId: 'cloud-cached',
      visibility: 'private',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
      storage: 'cloud',
    });
    setProjectSavedAt(cachedId, '2020-01-01T00:00:00.000Z');
    mockManifestSetItemFailures(quotaError(), 1);

    const result = patchProjectState(targetId, makeSerializedState({
      project: { title: 'Manifest Retry' } as SerializedAppState['project'],
    }));

    expect(result.ok).toBe(true);
    expect(result.evictedLocalIds).toEqual([cachedId]);
    expect(loadManifest().projects.find(p => p.localId === targetId)!.name).toBe('Manifest Retry');
    expect(hasLocalData(cachedId)).toBe(false);
  });
});
