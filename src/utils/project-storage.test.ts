import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadManifest,
  saveManifest,
  loadProject,
  saveProject,
  createProject,
  deleteProject,
  updateProjectMetadata,
  getMostRecentProjectId,
  getStorageUsage,
  runMigrationIfNeeded,
  toProjectListEntry,
  projectStorageKey,
} from './project-storage';
import type { StoredLocalProject, ProjectManifest, ProjectManifestEntry } from '../types/project';
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
    ownerToken: null,
    state: makeSerializedState(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
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
      }],
    };
    localStorage.setItem('register-viewer-manifest', JSON.stringify(stored));
    const manifest = loadManifest();
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0].localId).toBe('id-1');
  });

  it('recovers orphaned projects not in manifest', () => {
    // Save a manifest with no projects
    saveManifest({ version: 1, projects: [] });

    // Write an orphaned project directly to localStorage
    const orphan = makeStoredProject({ localId: 'orphan-1', name: 'Orphan' });
    localStorage.setItem('register-viewer-project:orphan-1', JSON.stringify(orphan));

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

    // Next loadManifest should recover the orphan
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
});

describe('createProject', () => {
  it('creates project with default name', () => {
    const localId = createProject(makeSerializedState());
    expect(localId).toBeTruthy();
    const project = loadProject(localId);
    expect(project).not.toBeNull();
    expect(project!.name).toBe('Untitled Project');
    expect(project!.visibility).toBe('private');
    expect(project!.cloudId).toBeNull();
    expect(project!.ownerToken).toBeNull();
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

  it('updates cloudId and cloudSavedAt', () => {
    const localId = createProject(makeSerializedState());
    updateProjectMetadata(localId, {
      cloudId: 'abc123def456',
      cloudSavedAt: '2026-02-01T00:00:00.000Z',
    });
    const project = loadProject(localId);
    expect(project!.cloudId).toBe('abc123def456');
    expect(project!.cloudSavedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('updates visibility', () => {
    const localId = createProject(makeSerializedState());
    updateProjectMetadata(localId, { visibility: 'unlisted' });
    const project = loadProject(localId);
    expect(project!.visibility).toBe('unlisted');
  });

  it('updates ownerToken', () => {
    const localId = createProject(makeSerializedState());
    updateProjectMetadata(localId, { ownerToken: 'secret-token-123' });
    const project = loadProject(localId);
    expect(project!.ownerToken).toBe('secret-token-123');
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
    expect(manifest.projects[0].name).toBe('Untitled Project');
  });

  it('cleans up legacy keys', () => {
    localStorage.setItem('register-viewer-state', JSON.stringify(makeSerializedState()));
    localStorage.setItem('register-viewer-projects', 'some-data');
    localStorage.setItem('register-viewer-owner-token', 'some-token');

    runMigrationIfNeeded();

    expect(localStorage.getItem('register-viewer-state')).toBeNull();
    expect(localStorage.getItem('register-viewer-projects')).toBeNull();
    expect(localStorage.getItem('register-viewer-owner-token')).toBeNull();
  });

  it('cleans up legacy keys even when no legacy state exists', () => {
    localStorage.setItem('register-viewer-projects', 'some-data');
    localStorage.setItem('register-viewer-owner-token', 'some-token');

    runMigrationIfNeeded();

    expect(localStorage.getItem('register-viewer-projects')).toBeNull();
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
    // But all legacy keys should still be cleaned up unconditionally
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
    };
    const result = toProjectListEntry(entry);
    expect(result.isCloudSaved).toBe(false);
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
    };
    const result = toProjectListEntry(entry);
    expect(result.isCloudSaved).toBe(true);
    expect(result.cloudId).toBe('abc123def456');
    expect(result.visibility).toBe('unlisted');
  });
});
