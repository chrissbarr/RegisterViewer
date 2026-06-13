import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  computeSyncPatches,
  syncCloudProjectsFromServer,
  positiveVersion,
  normalizeServerVersion,
  type ServerProject,
} from './cloud-sync';
import type { ProjectListEntry } from '../types/project';

vi.mock('./api-client', () => ({
  listProjects: vi.fn(),
}));

import { listProjects } from './api-client';

function makeEntry(overrides: Partial<ProjectListEntry> & { localId: string }): ProjectListEntry {
  return {
    cloudId: null,
    name: 'Test',
    visibility: 'private',
    createdAt: '2024-01-01T00:00:00Z',
    localSavedAt: '2024-01-01T00:00:00Z',
    cloudSavedAt: null,
    storage: 'local',
    ...overrides,
  };
}

function makeServer(overrides: Partial<ServerProject> & { id: string }): ServerProject {
  return {
    title: 'Server Project',
    visibility: 'private',
    updatedAt: '2024-01-02T00:00:00Z',
    version: 1,
    ...overrides,
  };
}

describe('positiveVersion', () => {
  it('returns the value for a positive version', () => {
    expect(positiveVersion(1)).toBe(1);
    expect(positiveVersion(42)).toBe(42);
  });

  it('returns null for zero (the unknown sentinel)', () => {
    expect(positiveVersion(0)).toBeNull();
  });

  it('returns null for a negative version', () => {
    expect(positiveVersion(-1)).toBeNull();
  });

  it('returns null for null and undefined', () => {
    expect(positiveVersion(null)).toBeNull();
    expect(positiveVersion(undefined)).toBeNull();
  });
});

describe('normalizeServerVersion', () => {
  it('returns the value for a positive version', () => {
    expect(normalizeServerVersion(1)).toBe(1);
    expect(normalizeServerVersion(42)).toBe(42);
  });

  it('returns 0 for zero', () => {
    expect(normalizeServerVersion(0)).toBe(0);
  });

  it('returns 0 for a negative version', () => {
    expect(normalizeServerVersion(-1)).toBe(0);
  });

  it('returns 0 for null and undefined (unknown / not-yet-fetched)', () => {
    expect(normalizeServerVersion(null)).toBe(0);
    expect(normalizeServerVersion(undefined)).toBe(0);
  });
});

describe('computeSyncPatches', () => {
  it('returns empty result when both lists are empty', () => {
    const result = computeSyncPatches([], []);
    expect(result.patches).toEqual([]);
    expect(result.staleCloudIds).toEqual([]);
    expect(result.cloudOnlyProjects).toEqual([]);
  });

  it('returns no patch when local and server metadata match', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', visibility: 'private', updatedAt: '2024-01-02T00:00:00Z' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([]);
    expect(result.staleCloudIds).toEqual([]);
    expect(result.cloudOnlyProjects).toEqual([]);
  });

  // Version is the sole payload identity: a missing/zero local serverVersion is
  // backfilled from list metadata regardless of timestamps.
  it('backfills a missing serverVersion from list metadata regardless of timestamps', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      // Deliberately mismatched timestamp — the old behavior depended on this
      // matching; the version-only rule no longer cares.
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
      serverVersion: null,
    })];
    const server = [makeServer({ id: 'c1', visibility: 'private', updatedAt: '2024-01-02T00:00:00Z', version: 7 })];

    const result = computeSyncPatches(local, server);
    // Server is newer and version was unknown: backfill the version AND advance
    // the informational timestamp.
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-02T00:00:00Z', serverVersion: 7 }]);
  });

  it('does not advance serverVersion from list metadata when both versions are known and differ', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', visibility: 'private', updatedAt: '2024-01-02T00:00:00Z', version: 2 })];

    const result = computeSyncPatches(local, server);
    // Known-but-different versions defer to the version-gated freshness GET; no
    // serverVersion patch. Timestamp still advances (informational only).
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-02T00:00:00Z' }]);
  });

  it('backfills a missing serverVersion even when the local timestamp is newer than the list timestamp', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-03T00:00:00Z',
      visibility: 'private',
      serverVersion: null,
    })];
    const server = [makeServer({ id: 'c1', visibility: 'private', updatedAt: '2024-01-02T00:00:00Z', version: 7 })];

    const result = computeSyncPatches(local, server);
    // Version unknown locally → backfill from list. Timestamp does NOT advance
    // (local is newer; never regress the informational timestamp).
    expect(result.patches).toEqual([{ localId: 'l1', serverVersion: 7 }]);
  });

  it('does not regress a higher local serverVersion from an older list response', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-03T00:00:00Z',
      visibility: 'private',
      serverVersion: 8,
    })];
    const server = [makeServer({ id: 'c1', visibility: 'unlisted', updatedAt: '2024-01-02T00:00:00Z', version: 7 })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([]);
  });

  it('generates cloudSavedAt patch when server is newer', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-03T00:00:00Z', visibility: 'private' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-03T00:00:00Z' }]);
  });

  it('generates visibility patch when server visibility differs', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-02T00:00:00Z', visibility: 'unlisted' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', visibility: 'unlisted' }]);
  });

  it('generates combined patch when both timestamp and visibility differ', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-05T00:00:00Z', visibility: 'unlisted' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{
      localId: 'l1',
      cloudSavedAt: '2024-01-05T00:00:00Z',
      visibility: 'unlisted',
    }]);
  });

  it('identifies stale cloud IDs (local has cloudId not on server)', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c-deleted',
      storage: 'cloud',
    })];
    const server: ServerProject[] = [];

    const result = computeSyncPatches(local, server);
    expect(result.staleCloudIds).toEqual(['c-deleted']);
    expect(result.staleCloudProjects).toEqual([{
      localId: 'l1',
      cloudId: 'c-deleted',
      cloudSavedAt: null,
      serverVersion: null,
    }]);
    expect(result.patches).toEqual([]);
  });

  it('identifies cloud-only projects (on server but not local)', () => {
    const local: ProjectListEntry[] = [];
    const server = [makeServer({ id: 'c-new', title: 'New Project', visibility: 'unlisted' })];

    const result = computeSyncPatches(local, server);
    expect(result.cloudOnlyProjects).toEqual(server);
  });

  it('treats saved local cloud-linked entries as local forks, not owned cloud identities', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'local',
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-06-01T00:00:00Z', visibility: 'unlisted' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([]);
    expect(result.staleCloudIds).toEqual([]);
    expect(result.cloudOnlyProjects).toEqual(server);
  });

  it('skips entries without cloudId', () => {
    const local = [makeEntry({ localId: 'l1', cloudId: null, storage: 'local' })];
    const server = [makeServer({ id: 'c1' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([]);
    expect(result.staleCloudIds).toEqual([]);
    expect(result.cloudOnlyProjects).toEqual(server);
  });

  it('handles mixed scenario with patches, stale, and cloud-only', () => {
    const local = [
      // Needs timestamp update
      makeEntry({ localId: 'l1', cloudId: 'c1', storage: 'cloud', cloudSavedAt: '2024-01-01T00:00:00Z', serverVersion: 1 }),
      // Stale — not on server
      makeEntry({ localId: 'l2', cloudId: 'c-gone', storage: 'cloud' }),
      // Local-only — no cloudId
      makeEntry({ localId: 'l3', cloudId: null, storage: 'local' }),
    ];
    const server = [
      makeServer({ id: 'c1', updatedAt: '2024-06-01T00:00:00Z' }),
      makeServer({ id: 'c-brand-new', title: 'Brand New' }),
    ];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-06-01T00:00:00Z' }]);
    expect(result.staleCloudIds).toEqual(['c-gone']);
    expect(result.cloudOnlyProjects).toHaveLength(1);
    expect(result.cloudOnlyProjects[0].id).toBe('c-brand-new');
  });

  it('skips timestamp and version patch when server date is malformed', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: 'not-a-date', visibility: 'private' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([]);
  });

  it('treats malformed local date as epoch 0 for comparison', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: 'garbage',
      visibility: 'private',
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-02T00:00:00Z', visibility: 'private' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-02T00:00:00Z' }]);
  });

  it('treats null cloudSavedAt as epoch 0 for comparison', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: null,
      serverVersion: 1,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-01T00:00:00Z' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-01T00:00:00Z' }]);
  });

  // Same-second DATETIME(1s) collision: identical updatedAt strings must NOT be
  // treated as payload identity. Pre-fix wrongly adopted the listed version.
  it('does not adopt a differing server version on a same-second timestamp collision', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
      serverVersion: 3,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-02T00:00:00Z', visibility: 'private', version: 7 })];

    const result = computeSyncPatches(local, server);
    // Known-but-different versions: no serverVersion patch despite the identical
    // timestamp. Timestamps are equal so no informational advance either.
    expect(result.patches).toEqual([]);
  });
});

describe('syncCloudProjectsFromServer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies metadata patches from server response', async () => {
    const projects = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      serverVersion: 1,
    })];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [makeServer({ id: 'c1', updatedAt: '2024-06-01T00:00:00Z' })],
    });
    const updateCloudMetadata = vi.fn();
    const createPlaceholder = vi.fn();

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata,
      createPlaceholder,
      reconcileStaleCloudProject: vi.fn(() => true),
    });

    expect(updateCloudMetadata).toHaveBeenCalledWith(
      'l1',
      { cloudSavedAt: '2024-06-01T00:00:00Z' },
      { preserveLocalSavedAt: true },
    );
    expect(result.updatedCount).toBe(1);
    expect(result.staleCloudIds).toEqual([]);
    expect(result.placeholdersCreated).toBe(0);
  });

  it('does not call updateCloudMetadata for an exact metadata match', async () => {
    const projects = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
      serverVersion: 1,
    })];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [makeServer({ id: 'c1', updatedAt: '2024-01-02T00:00:00Z', visibility: 'private', version: 1 })],
    });
    const updateCloudMetadata = vi.fn();
    const createPlaceholder = vi.fn();

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata,
      createPlaceholder,
      reconcileStaleCloudProject: vi.fn(() => true),
    });

    expect(updateCloudMetadata).not.toHaveBeenCalled();
    expect(result.updatedCount).toBe(0);
    expect(result.staleCloudIds).toEqual([]);
    expect(result.placeholdersCreated).toBe(0);
  });

  it('creates placeholders for cloud-only projects', async () => {
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [makeServer({ id: 'c-new', title: 'Remote Only', visibility: 'unlisted', updatedAt: '2024-05-01T00:00:00Z' })],
    });
    const updateCloudMetadata = vi.fn();
    const createPlaceholder = vi.fn();

    const result = await syncCloudProjectsFromServer('jwt-token', [], {
      updateCloudMetadata,
      createPlaceholder,
      reconcileStaleCloudProject: vi.fn(() => true),
    });

    expect(createPlaceholder).toHaveBeenCalledWith({
      title: 'Remote Only',
      cloudId: 'c-new',
      visibility: 'unlisted',
      cloudSavedAt: '2024-05-01T00:00:00Z',
      serverVersion: 1,
    });
    expect(result.placeholdersCreated).toBe(1);
  });

  it('creates an owned placeholder instead of reusing a saved local cloud-linked entry', async () => {
    const projects = [makeEntry({
      localId: 'local-fork',
      cloudId: 'cloud-owned',
      storage: 'local',
    })];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [makeServer({ id: 'cloud-owned', title: 'Owned Remote', visibility: 'unlisted', updatedAt: '2024-05-01T00:00:00Z', version: 6 })],
    });
    const updateCloudMetadata = vi.fn();
    const createPlaceholder = vi.fn();

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata,
      createPlaceholder,
      reconcileStaleCloudProject: vi.fn(() => true),
    });

    expect(updateCloudMetadata).not.toHaveBeenCalled();
    expect(createPlaceholder).toHaveBeenCalledWith({
      title: 'Owned Remote',
      cloudId: 'cloud-owned',
      visibility: 'unlisted',
      cloudSavedAt: '2024-05-01T00:00:00Z',
      serverVersion: 6,
    });
    expect(result.placeholdersCreated).toBe(1);
  });

  it('counts only placeholders actually created by the callback', async () => {
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [makeServer({ id: 'cloud-new', title: 'Remote Only', visibility: 'private' })],
    });
    const createPlaceholder = vi.fn(() => false);

    const result = await syncCloudProjectsFromServer('jwt-token', [], {
      updateCloudMetadata: vi.fn(),
      createPlaceholder,
      reconcileStaleCloudProject: vi.fn(() => true),
    });

    expect(result.placeholdersCreated).toBe(0);
  });

  it('returns stale cloud IDs', async () => {
    const projects = [makeEntry({
      localId: 'l1',
      cloudId: 'c-deleted',
      storage: 'cloud',
    })];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({ projects: [] });
    const updateCloudMetadata = vi.fn();
    const createPlaceholder = vi.fn();
    const reconcileStaleCloudProject = vi.fn(() => true);

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata,
      createPlaceholder,
      reconcileStaleCloudProject,
    });

    expect(result.staleCloudIds).toEqual(['c-deleted']);
    expect(reconcileStaleCloudProject).toHaveBeenCalledWith(
      expect.objectContaining({
        localId: 'l1',
        cloudId: 'c-deleted',
      }),
      { protectedLocalIds: ['l1'] },
    );
    expect(result.staleReconciledCloudIds).toEqual(['c-deleted']);
    expect(result.staleReconcileFailedCloudIds).toEqual([]);
  });

  it('reconciles stale projects before other writes and protects them from quota eviction', async () => {
    const projects = [
      makeEntry({
        localId: 'stale-local',
        cloudId: 'stale-cloud',
        storage: 'cloud',
      }),
      makeEntry({
        localId: 'patched-local',
        cloudId: 'patched-cloud',
        storage: 'cloud',
        // Version + timestamp already match the server: only visibility differs,
        // keeping this test focused on ordering/protection rather than the
        // version-identity behavior covered elsewhere.
        cloudSavedAt: '2024-01-02T00:00:00Z',
        serverVersion: 1,
      }),
    ];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [
        makeServer({ id: 'patched-cloud', visibility: 'unlisted', updatedAt: '2024-01-02T00:00:00Z', version: 1 }),
        makeServer({ id: 'new-cloud', title: 'Remote Only' }),
      ],
    });
    const calls: string[] = [];
    const updateCloudMetadata = vi.fn(() => { calls.push('patch'); });
    const createPlaceholder = vi.fn(() => { calls.push('placeholder'); });
    const reconcileStaleCloudProject = vi.fn(() => { calls.push('reconcile-stale'); return true; });

    await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata,
      createPlaceholder,
      reconcileStaleCloudProject,
    });

    expect(calls).toEqual(['reconcile-stale', 'patch', 'placeholder']);
    expect(reconcileStaleCloudProject).toHaveBeenCalledWith(
      expect.objectContaining({ localId: 'stale-local', cloudId: 'stale-cloud' }),
      { protectedLocalIds: ['stale-local'] },
    );
    expect(updateCloudMetadata).toHaveBeenCalledWith(
      'patched-local',
      { visibility: 'unlisted' },
      { preserveLocalSavedAt: true, protectedLocalIds: ['stale-local'] },
    );
    expect(createPlaceholder).toHaveBeenCalledWith(
      expect.objectContaining({ cloudId: 'new-cloud' }),
      { protectedLocalIds: ['stale-local'] },
    );
  });

  it('reconciles dirty and conflicted stale owned cloud projects', async () => {
    const projects = [makeEntry({
      localId: 'dirty-local',
      cloudId: 'dirty-cloud',
      storage: 'cloud',
      hasUnsyncedChanges: true,
      cloudConflictVersion: 9,
    })];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({ projects: [] });
    const reconcileStaleCloudProject = vi.fn(() => true);

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata: vi.fn(),
      createPlaceholder: vi.fn(),
      reconcileStaleCloudProject,
    });

    expect(reconcileStaleCloudProject).toHaveBeenCalledWith(
      expect.objectContaining({
        localId: 'dirty-local',
        cloudId: 'dirty-cloud',
      }),
      { protectedLocalIds: ['dirty-local'] },
    );
    expect(result.staleReconciledCloudIds).toEqual(['dirty-cloud']);
  });

  it('does not reconcile saved local cloud-linked forks as stale owned projects', async () => {
    const projects = [makeEntry({
      localId: 'local-fork',
      cloudId: 'shared-cloud-id',
      storage: 'local',
    })];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({ projects: [] });
    const reconcileStaleCloudProject = vi.fn();

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata: vi.fn(),
      createPlaceholder: vi.fn(),
      reconcileStaleCloudProject,
    });

    expect(reconcileStaleCloudProject).not.toHaveBeenCalled();
    expect(result.staleCloudIds).toEqual([]);
    expect(result.staleReconciledCloudIds).toEqual([]);
  });

  it('reports stale reconciliation failures and continues', async () => {
    const projects = [
      makeEntry({ localId: 'ok-local', cloudId: 'ok-cloud', storage: 'cloud' }),
      makeEntry({ localId: 'failed-local', cloudId: 'failed-cloud', storage: 'cloud' }),
      makeEntry({ localId: 'later-local', cloudId: 'later-cloud', storage: 'cloud' }),
    ];
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({ projects: [] });
    const reconcileStaleCloudProject = vi.fn(({ cloudId }: { cloudId: string }) => {
      if (cloudId === 'failed-cloud') throw new Error('local write failed');
      return true;
    });

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata: vi.fn(),
      createPlaceholder: vi.fn(),
      reconcileStaleCloudProject,
    });

    expect(reconcileStaleCloudProject).toHaveBeenCalledTimes(3);
    expect(result.staleCloudIds).toEqual(['ok-cloud', 'failed-cloud', 'later-cloud']);
    expect(result.staleReconciledCloudIds).toEqual(['ok-cloud', 'later-cloud']);
    expect(result.staleReconcileFailedCloudIds).toEqual(['failed-cloud']);
  });

  it('uses default project name when server title is null', async () => {
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [makeServer({ id: 'c-no-title', title: null, updatedAt: '2024-05-01T00:00:00Z' })],
    });
    const createPlaceholder = vi.fn();

    await syncCloudProjectsFromServer('jwt-token', [], {
      updateCloudMetadata: vi.fn(),
      createPlaceholder,
      reconcileStaleCloudProject: vi.fn(() => true),
    });

    expect(createPlaceholder).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Untitled Project' }),
    );
  });
});
