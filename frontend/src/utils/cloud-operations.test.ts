import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from './cloud-operations';

vi.mock('./api-client', () => ({
  ApiError: class ApiError extends Error {
    status: number;
    errorBody: { error: string };
    constructor(status: number, errorBody: { error: string }) {
      super(errorBody.error);
      this.name = 'ApiError';
      this.status = status;
      this.errorBody = errorBody;
    }
  },
  createProject: vi.fn(),
  updateProject: vi.fn(),
  patchProjectVisibility: vi.fn(),
  deleteProject: vi.fn(),
}));

import { ApiError, createProject, updateProject, patchProjectVisibility, deleteProject } from './api-client';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('saveProjectToCloudImpl', () => {
  const payload = { version: 1, registers: [] };
  const jwt = 'test-jwt-token';

  it('creates a new project when no existingCloudId', async () => {
    (createProject as Mock).mockResolvedValue({
      id: 'cloud-new',
      createdAt: '2024-01-01T00:00:00Z',
      version: 1,
    });

    const result = await saveProjectToCloudImpl(payload, null, jwt);

    expect(result).toEqual({
      kind: 'created',
      cloudId: 'cloud-new',
      timestamp: '2024-01-01T00:00:00Z',
      version: 1,
    });
    expect(createProject).toHaveBeenCalledWith(payload, jwt);
  });

  it('updates existing project when existingCloudId provided', async () => {
    (updateProject as Mock).mockResolvedValue({
      id: 'cloud-abc',
      updatedAt: '2024-01-02T00:00:00Z',
      version: 2,
    });

    const result = await saveProjectToCloudImpl(payload, 'cloud-abc', jwt);

    expect(result).toEqual({
      kind: 'updated',
      cloudId: 'cloud-abc',
      timestamp: '2024-01-02T00:00:00Z',
      version: 2,
    });
    expect(updateProject).toHaveBeenCalledWith('cloud-abc', payload, jwt, 1);
  });

  it('defaults to version 1 when serverVersion is undefined', async () => {
    (updateProject as Mock).mockResolvedValue({
      id: 'cloud-abc',
      updatedAt: '2024-01-02T00:00:00Z',
      version: 2,
    });

    await saveProjectToCloudImpl(payload, 'cloud-abc', jwt, undefined);

    expect(updateProject).toHaveBeenCalledWith('cloud-abc', payload, jwt, 1);
  });

  it('passes explicit serverVersion when provided', async () => {
    (updateProject as Mock).mockResolvedValue({
      id: 'cloud-abc',
      updatedAt: '2024-01-02T00:00:00Z',
      version: 4,
    });

    await saveProjectToCloudImpl(payload, 'cloud-abc', jwt, 3);

    expect(updateProject).toHaveBeenCalledWith('cloud-abc', payload, jwt, 3);
  });

  it('returns not-found when update gets 404', async () => {
    (updateProject as Mock).mockRejectedValue(
      new ApiError(404, { error: 'Not found' }),
    );

    const result = await saveProjectToCloudImpl(payload, 'cloud-gone', jwt);

    expect(result).toEqual({ kind: 'not-found' });
    expect(updateProject).toHaveBeenCalledWith('cloud-gone', payload, jwt, 1);
  });

  it('returns conflict with serverVersion when update gets 409', async () => {
    const err = new ApiError(409, { error: 'Conflict', currentVersion: 5 });
    (updateProject as Mock).mockRejectedValue(err);

    const result = await saveProjectToCloudImpl(payload, 'cloud-abc', jwt, 3);

    expect(result).toEqual({ kind: 'conflict', serverVersion: 5 });
  });

  it('throws on network error during update', async () => {
    (updateProject as Mock).mockRejectedValue(new Error('Network error'));

    await expect(saveProjectToCloudImpl(payload, 'cloud-abc', jwt)).rejects.toThrow('Network error');
  });

  it('throws on network error during create', async () => {
    (createProject as Mock).mockRejectedValue(new Error('Network error'));

    await expect(saveProjectToCloudImpl(payload, null, jwt)).rejects.toThrow('Network error');
  });
});

describe('deleteProjectFromCloudImpl', () => {
  const jwt = 'test-jwt-token';

  it('deletes a cloud project', async () => {
    (deleteProject as Mock).mockResolvedValue(undefined);

    await deleteProjectFromCloudImpl('cloud-del', jwt);

    expect(deleteProject).toHaveBeenCalledWith('cloud-del', jwt);
  });

  it('propagates API errors', async () => {
    (deleteProject as Mock).mockRejectedValue(new Error('Server error'));

    await expect(deleteProjectFromCloudImpl('cloud-del', jwt)).rejects.toThrow('Server error');
  });
});

describe('patchVisibilityImpl', () => {
  const jwt = 'test-jwt-token';

  it('patches visibility via PATCH endpoint', async () => {
    (patchProjectVisibility as Mock).mockResolvedValue({
      id: 'cloud-vis',
      updatedAt: '2024-01-03T00:00:00Z',
    });

    await patchVisibilityImpl('cloud-vis', 'unlisted', jwt);

    expect(patchProjectVisibility).toHaveBeenCalledWith('cloud-vis', 'unlisted', jwt);
  });

  it('propagates API errors', async () => {
    (patchProjectVisibility as Mock).mockRejectedValue(new Error('Server error'));

    await expect(patchVisibilityImpl('cloud-vis', 'private', jwt)).rejects.toThrow('Server error');
  });
});
