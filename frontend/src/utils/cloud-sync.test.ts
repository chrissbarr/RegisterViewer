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

  it('returns version-only patch when local and server timestamps/visibility match', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
    })];
    const server = [makeServer({ id: 'c1', visibility: 'private', updatedAt: '2024-01-02T00:00:00Z' })];

    const result = computeSyncPatches(local, server);
    // serverVersion is always propagated
    expect(result.patches).toEqual([{ localId: 'l1', serverVersion: 1 }]);
    expect(result.staleCloudIds).toEqual([]);
    expect(result.cloudOnlyProjects).toEqual([]);
  });

  it('generates cloudSavedAt patch when server is newer', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-03T00:00:00Z', visibility: 'private' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-03T00:00:00Z', serverVersion: 1 }]);
  });

  it('generates visibility patch when server visibility differs', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-02T00:00:00Z', visibility: 'unlisted' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', visibility: 'unlisted', serverVersion: 1 }]);
  });

  it('generates combined patch when both timestamp and visibility differ', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-05T00:00:00Z', visibility: 'unlisted' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{
      localId: 'l1',
      cloudSavedAt: '2024-01-05T00:00:00Z',
      visibility: 'unlisted',
      serverVersion: 1,
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

  it('skips entries with storage !== cloud', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'local', // shared project loaded via link
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-06-01T00:00:00Z', visibility: 'unlisted' })];

    const result = computeSyncPatches(local, server);
    // No patches because local entry has storage=local
    expect(result.patches).toEqual([]);
    expect(result.staleCloudIds).toEqual([]);
    // c1 IS in localCloudIds set (because entry has cloudId), so not cloud-only
    expect(result.cloudOnlyProjects).toEqual([]);
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
      makeEntry({ localId: 'l1', cloudId: 'c1', storage: 'cloud', cloudSavedAt: '2024-01-01T00:00:00Z' }),
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
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-06-01T00:00:00Z', serverVersion: 1 }]);
    expect(result.staleCloudIds).toEqual(['c-gone']);
    expect(result.cloudOnlyProjects).toHaveLength(1);
    expect(result.cloudOnlyProjects[0].id).toBe('c-brand-new');
  });

  it('skips timestamp patch when server date is malformed (but still propagates version)', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-01T00:00:00Z',
      visibility: 'private',
    })];
    const server = [makeServer({ id: 'c1', updatedAt: 'not-a-date', visibility: 'private' })];

    const result = computeSyncPatches(local, server);
    // No cloudSavedAt patch (malformed date), but serverVersion still propagated
    expect(result.patches).toEqual([{ localId: 'l1', serverVersion: 1 }]);
  });

  it('treats malformed local date as epoch 0 for comparison', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: 'garbage',
      visibility: 'private',
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-02T00:00:00Z', visibility: 'private' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-02T00:00:00Z', serverVersion: 1 }]);
  });

  it('treats null cloudSavedAt as epoch 0 for comparison', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: null,
    })];
    const server = [makeServer({ id: 'c1', updatedAt: '2024-01-01T00:00:00Z' })];

    const result = computeSyncPatches(local, server);
    expect(result.patches).toEqual([{ localId: 'l1', cloudSavedAt: '2024-01-01T00:00:00Z', serverVersion: 1 }]);
  });

  it('propagates serverVersion from server projects in patches', () => {
    const local = [makeEntry({
      localId: 'l1',
      cloudId: 'c1',
      storage: 'cloud',
      cloudSavedAt: '2024-01-02T00:00:00Z',
      visibility: 'private',
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

    expect(updateCloudMetadata).toHaveBeenCalledWith('l1', { cloudSavedAt: '2024-06-01T00:00:00Z', serverVersion: 1 });
    expect(result.updatedCount).toBe(1);
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
    });
    expect(result.placeholdersCreated).toBe(1);
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
