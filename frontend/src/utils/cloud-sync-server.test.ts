import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncCloudProjectsFromServer } from './cloud-sync';
import type { ProjectListEntry } from '../types/project';
import type { ServerProject } from './cloud-sync';

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
    ...overrides,
  };
}

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

    expect(updateCloudMetadata).toHaveBeenCalledWith('l1', { cloudSavedAt: '2024-06-01T00:00:00Z' });
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
