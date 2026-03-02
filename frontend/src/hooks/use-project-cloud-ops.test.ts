import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useProjectCloudOps } from './use-project-cloud-ops';

vi.mock('../utils/storage', () => ({
  exportToObject: vi.fn(() => ({ version: 1, registers: [] })),
  deserializeState: vi.fn(() => ({ registers: [], registerValues: {} })),
}));

vi.mock('../utils/api-client', () => ({
  isCloudEnabled: vi.fn(() => true),
}));

vi.mock('../utils/project-storage', () => ({
  loadProject: vi.fn(),
  buildProjectUrl: vi.fn((id: string) => `https://app/#/p/${id}`),
}));

vi.mock('../utils/cloud-url', () => ({
  setCloudUrl: vi.fn(),
  clearCloudUrl: vi.fn(),
  CLEARED_CLOUD_METADATA: {
    cloudId: null,
    visibility: 'private',
    cloudSavedAt: null,
  },
  withMutationLock: vi.fn(async (_ref: unknown, fn: () => Promise<unknown>) => fn()),
}));

vi.mock('../utils/cloud-operations', () => ({
  saveProjectToCloudImpl: vi.fn(),
  deleteProjectFromCloudImpl: vi.fn(),
  patchVisibilityImpl: vi.fn(),
}));

import { isCloudEnabled } from '../utils/api-client';
import { loadProject } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl } from '../utils/cloud-url';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import type { ProjectListEntry } from '../types/project';

function makeInitialState() {
  return {
    cloudId: null as string | null,
    isOwner: false,
    status: 'idle' as const,
    error: null as string | null,
    shareUrl: null as string | null,
    lastCloudSavedAt: null as string | null,
    lastSavedVersion: -1,
    visibility: 'private' as const,
  };
}

function makeProjectList(entries: Array<{ localId: string; cloudId?: string | null }>): ProjectListEntry[] {
  return entries.map(p => ({
    localId: p.localId,
    cloudId: p.cloudId ?? null,
    name: 'Test',
    visibility: 'private' as const,
    createdAt: '2026-01-01T00:00:00Z',
    localSavedAt: '2026-01-01T00:00:00Z',
    cloudSavedAt: null,
    isCloudSaved: (p.cloudId ?? null) !== null,
  }));
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const initial = makeInitialState();
  const internalRef = { current: overrides.internalState as typeof initial ?? initial };
  return {
    updateCloudMetadata: vi.fn() as Mock,
    projects: (overrides.projects as ProjectListEntry[]) ?? makeProjectList([{ localId: 'local-1', cloudId: 'cloud-1' }]),
    activeLocalIdRef: { current: (overrides.activeLocalId as string) ?? 'local-1' },
    dataVersionRef: { current: 1 },
    mutationLockRef: { current: false },
    internalRef,
    setInternal: vi.fn() as Mock,
    initialInternalState: initial,
    getJwt: (overrides.getJwt as (() => string | null)) ?? (() => 'mock-jwt'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (isCloudEnabled as Mock).mockReturnValue(true);
  (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: null });
});

describe('useProjectCloudOps', () => {
  describe('saveProjectToCloud', () => {
    it('creates a new cloud project when no existing cloudId', async () => {
      const deps = makeDeps({ projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });
      (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: null });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: 'new-cloud',
        timestamp: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudId: 'new-cloud',
        cloudSavedAt: '2026-01-01T00:00:00Z',
      });
      expect(setCloudUrl).toHaveBeenCalledWith('new-cloud');
      expect(deps.setInternal).toHaveBeenCalled();
    });

    it('updates an existing cloud project', async () => {
      const deps = makeDeps();
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        timestamp: '2026-01-02T00:00:00Z',
      });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudSavedAt: '2026-01-02T00:00:00Z',
      });
      // Should NOT set cloud URL for updates
      expect(setCloudUrl).not.toHaveBeenCalled();
    });

    it('throws when project not found locally', async () => {
      const deps = makeDeps();
      (loadProject as Mock).mockReturnValue(null);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('missing');
        }),
      ).rejects.toThrow('Project not found.');
    });

    it('throws when cloud returns not-found', async () => {
      const deps = makeDeps();
      (saveProjectToCloudImpl as Mock).mockResolvedValue({ kind: 'not-found' });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('local-1');
        }),
      ).rejects.toThrow('Cloud project not found on server.');
    });

    it('skips when cloud is not enabled', async () => {
      const deps = makeDeps();
      (isCloudEnabled as Mock).mockReturnValue(false);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('does not update cloud state for non-active project on create', async () => {
      const deps = makeDeps({ activeLocalId: 'other-local', projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });
      (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: null });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: 'new-cloud',
        timestamp: '2026-01-01T00:00:00Z',
      });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(deps.updateCloudMetadata).toHaveBeenCalled();
      expect(setCloudUrl).not.toHaveBeenCalled();
      expect(deps.setInternal).not.toHaveBeenCalled();
    });
  });

  describe('deleteProjectFromCloud', () => {
    it('deletes and clears metadata for matching project', async () => {
      const deps = makeDeps();
      (deleteProjectFromCloudImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteProjectFromCloud('cloud-1');
      });

      expect(deleteProjectFromCloudImpl).toHaveBeenCalledWith('cloud-1', 'mock-jwt');
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudId: null,
        visibility: 'private',
        cloudSavedAt: null,
      });
    });

    it('clears cloud state when deleting active project', async () => {
      const internalState = { ...makeInitialState(), cloudId: 'cloud-1' };
      const deps = makeDeps({ internalState });
      (deleteProjectFromCloudImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteProjectFromCloud('cloud-1');
      });

      expect(clearCloudUrl).toHaveBeenCalled();
      expect(deps.setInternal).toHaveBeenCalled();
    });

    it('does not clear cloud state when deleting non-active project', async () => {
      const deps = makeDeps(); // internalRef.current.cloudId is null (different from cloud-1)
      (deleteProjectFromCloudImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteProjectFromCloud('cloud-1');
      });

      expect(clearCloudUrl).not.toHaveBeenCalled();
    });
  });

  describe('setProjectVisibility', () => {
    it('patches visibility and updates metadata', async () => {
      const deps = makeDeps();
      (patchVisibilityImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.setProjectVisibility('local-1', 'unlisted');
      });

      expect(patchVisibilityImpl).toHaveBeenCalledWith('cloud-1', 'unlisted', 'mock-jwt');
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', { visibility: 'unlisted' });
    });

    it('updates internal state when targeting active project', async () => {
      const deps = makeDeps({ activeLocalId: 'local-1' });
      (patchVisibilityImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.setProjectVisibility('local-1', 'unlisted');
      });

      expect(deps.setInternal).toHaveBeenCalled();
    });

    it('returns early when project has no cloudId', async () => {
      const deps = makeDeps({ projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.setProjectVisibility('local-1', 'unlisted');
      });

      expect(patchVisibilityImpl).not.toHaveBeenCalled();
    });
  });

  describe('unlinkCloudProject', () => {
    it('clears cloud metadata for the project', () => {
      const deps = makeDeps();

      const { result } = renderHook(() => useProjectCloudOps(deps));

      act(() => {
        result.current.unlinkCloudProject('local-1');
      });

      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudId: null,
        visibility: 'private',
        cloudSavedAt: null,
      });
    });

    it('clears cloud state when unlinking active project', () => {
      const internalState = { ...makeInitialState(), cloudId: 'cloud-1' };
      const deps = makeDeps({ internalState });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      act(() => {
        result.current.unlinkCloudProject('local-1');
      });

      expect(clearCloudUrl).toHaveBeenCalled();
      expect(deps.setInternal).toHaveBeenCalled();
    });

    it('does nothing when project has no cloudId', () => {
      const deps = makeDeps({ projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      act(() => {
        result.current.unlinkCloudProject('local-1');
      });

      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });

    it('does nothing when project not found in manifest', () => {
      const deps = makeDeps({ projects: makeProjectList([]) });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      act(() => {
        result.current.unlinkCloudProject('missing');
      });

      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });
  });
});
