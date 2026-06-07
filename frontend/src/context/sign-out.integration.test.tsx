import { describe, it, expect, beforeEach } from 'vitest';
import { createProject, loadProject, loadManifest, purgeCloudProjects } from '../utils/project-storage';
import { EMPTY_SERIALIZED_STATE } from '../utils/storage';

describe('sign-out purge (integration, real storage)', () => {
  beforeEach(() => localStorage.clear());

  it('preserves unsynced cloud project data as a local project and removes synced ones', () => {
    const clean = createProject(EMPTY_SERIALIZED_STATE, 'Clean', { cloudId: 'cc', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud', serverVersion: 3, hasUnsyncedChanges: false });
    const dirty = createProject(EMPTY_SERIALIZED_STATE, 'Dirty', { cloudId: 'cd', visibility: 'private', cloudSavedAt: '2024-01-01', storage: 'cloud', serverVersion: 3, hasUnsyncedChanges: true });

    const { removed, demoted } = purgeCloudProjects();

    expect(removed).toEqual([clean]);
    expect(demoted).toEqual([dirty]);
    expect(loadProject(clean)).toBeNull();

    const survivor = loadProject(dirty)!;
    expect(survivor.storage).toBe('local');
    expect(survivor.cloudId).toBeNull();
    expect(loadManifest().projects.map((p) => p.localId)).toEqual([dirty]);
  });
});
