import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeSyncPatches, syncCloudProjectsFromServer, type ServerProject } from './cloud-sync';
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

  it('repairs missing serverVersion when cloudSavedAt matches the server timestamp', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
      serverVersion: null,
    })];
    const server = [makeServer({ id: 'c1', visibility: 'private', updatedAt: '2024-01-02T00:00:00Z', version: 7 })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', serverVersion: 7 }]);
  });

  it('does not advance serverVersion from list metadata when the server payload is newer', () => {
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
    expect(result.patches).toEqual([]);
  });

  it('does not repair serverVersion when the local timestamp is newer than the list timestamp', () => {
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
    expect(result.patches).toEqual([]);
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

  it('repairs stale serverVersion when cloudSavedAt matches the server timestamp', () => {
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
    expect(result.patches).toEqual([{ localId: 'l1', serverVersion: 7 }]);
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

    const result = await syncCloudProjectsFromServer('jwt-token', projects, {
      updateCloudMetadata,
      createPlaceholder,
    });

    expect(result.staleCloudIds).toEqual(['c-deleted']);
  });

  it('uses default project name when server title is null', async () => {
    (listProjects as ReturnType<typeof vi.fn>).mockResolvedValue({
      projects: [makeServer({ id: 'c-no-title', title: null, updatedAt: '2024-05-01T00:00:00Z' })],
    });
    const createPlaceholder = vi.fn();

    await syncCloudProjectsFromServer('jwt-token', [], {
      updateCloudMetadata: vi.fn(),
      createPlaceholder,
    });

    expect(createPlaceholder).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Untitled Project' }),
    );
  });
});
