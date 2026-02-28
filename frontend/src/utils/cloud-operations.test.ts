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

vi.mock('./owner-token', () => ({
  getOrCreateOwnerToken: vi.fn(() => 'mock-owner-token'),
  hashOwnerToken: vi.fn(async () => 'mock-token-hash'),
  getOwnerTokenForProject: vi.fn(() => 'mock-project-token'),
}));

import { ApiError, createProject, updateProject, patchProjectVisibility, deleteProject } from './api-client';
import { getOrCreateOwnerToken, hashOwnerToken, getOwnerTokenForProject } from './owner-token';

beforeEach(() => {
  vi.clearAllMocks();
  (getOrCreateOwnerToken as Mock).mockReturnValue('mock-owner-token');
  (hashOwnerToken as Mock).mockResolvedValue('mock-token-hash');
  (getOwnerTokenForProject as Mock).mockReturnValue('mock-project-token');
});

describe('saveProjectToCloudImpl', () => {
  const payload = { version: 1, registers: [] };

  it('creates a new project when no existingCloudId', async () => {
    (createProject as Mock).mockResolvedValue({
      id: 'cloud-new',
      createdAt: '2024-01-01T00:00:00Z',
    });

    const result = await saveProjectToCloudImpl(payload, null);

    expect(result).toEqual({
      kind: 'created',
      cloudId: 'cloud-new',
      timestamp: '2024-01-01T00:00:00Z',
      ownerToken: 'mock-owner-token',
    });
    expect(getOrCreateOwnerToken).toHaveBeenCalled();
    expect(createProject).toHaveBeenCalledWith(payload, 'mock-token-hash', undefined, undefined);
  });

  it('updates existing project when existingCloudId provided', async () => {
    (updateProject as Mock).mockResolvedValue({
      id: 'cloud-abc',
      updatedAt: '2024-01-02T00:00:00Z',
    });

    const result = await saveProjectToCloudImpl(payload, 'cloud-abc');

    expect(result).toEqual({
      kind: 'updated',
      cloudId: 'cloud-abc',
      timestamp: '2024-01-02T00:00:00Z',
    });
    expect(getOwnerTokenForProject).toHaveBeenCalledWith('cloud-abc');
    expect(updateProject).toHaveBeenCalledWith('cloud-abc', payload, 'mock-token-hash');
  });

  it('returns not-found when update gets 404', async () => {
    (updateProject as Mock).mockRejectedValue(
      new ApiError(404, { error: 'Not found' }),
    );

    const result = await saveProjectToCloudImpl(payload, 'cloud-gone');

    expect(result).toEqual({ kind: 'not-found' });
  });

  it('throws when owner token missing for update', async () => {
    (getOwnerTokenForProject as Mock).mockReturnValue(null);

    await expect(saveProjectToCloudImpl(payload, 'cloud-abc')).rejects.toThrow(
      'Owner token not found for this project.',
    );
  });

  it('throws on network error during update', async () => {
    (updateProject as Mock).mockRejectedValue(new Error('Network error'));

    await expect(saveProjectToCloudImpl(payload, 'cloud-abc')).rejects.toThrow('Network error');
  });

  it('throws on network error during create', async () => {
    (createProject as Mock).mockRejectedValue(new Error('Network error'));

    await expect(saveProjectToCloudImpl(payload, null)).rejects.toThrow('Network error');
  });
});

describe('deleteProjectFromCloudImpl', () => {
  it('deletes a cloud project', async () => {
    (deleteProject as Mock).mockResolvedValue(undefined);

    await deleteProjectFromCloudImpl('cloud-del');

    expect(getOwnerTokenForProject).toHaveBeenCalledWith('cloud-del');
    expect(deleteProject).toHaveBeenCalledWith('cloud-del', 'mock-token-hash');
  });

  it('throws when owner token missing', async () => {
    (getOwnerTokenForProject as Mock).mockReturnValue(null);

    await expect(deleteProjectFromCloudImpl('cloud-del')).rejects.toThrow(
      'Owner token not found.',
    );
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it('propagates API errors', async () => {
    (deleteProject as Mock).mockRejectedValue(new Error('Server error'));

    await expect(deleteProjectFromCloudImpl('cloud-del')).rejects.toThrow('Server error');
  });
});

describe('patchVisibilityImpl', () => {
  it('patches visibility via PATCH endpoint', async () => {
    (patchProjectVisibility as Mock).mockResolvedValue({
      id: 'cloud-vis',
      updatedAt: '2024-01-03T00:00:00Z',
    });

    await patchVisibilityImpl('cloud-vis', 'unlisted');

    expect(getOwnerTokenForProject).toHaveBeenCalledWith('cloud-vis');
    expect(patchProjectVisibility).toHaveBeenCalledWith('cloud-vis', 'unlisted', 'mock-token-hash');
  });

  it('throws when owner token missing', async () => {
    (getOwnerTokenForProject as Mock).mockReturnValue(null);

    await expect(patchVisibilityImpl('cloud-vis', 'unlisted')).rejects.toThrow(
      'Owner token not found.',
    );
    expect(patchProjectVisibility).not.toHaveBeenCalled();
  });

  it('propagates API errors', async () => {
    (patchProjectVisibility as Mock).mockRejectedValue(new Error('Server error'));

    await expect(patchVisibilityImpl('cloud-vis', 'private')).rejects.toThrow('Server error');
  });
});
