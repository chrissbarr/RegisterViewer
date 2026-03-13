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

vi.mock('../utils/cloud-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/cloud-url')>();
  return {
    ...actual,
    setCloudUrl: vi.fn(),
    clearCloudUrl: vi.fn(),
  };
});

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
    storage: 'local' as const,
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
    storage: (p.cloudId ?? null) !== null ? 'cloud' as const : 'local' as const,
  }));
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const initial = makeInitialState();
  const internalRef = { current: overrides.internalState as typeof initial ?? initial };
  const projects = (overrides.projects as ProjectListEntry[]) ?? makeProjectList([{ localId: 'local-1', cloudId: 'cloud-1' }]);
  return {
    updateCloudMetadata: vi.fn() as Mock,
    projectsRef: { current: projects },
    activeLocalIdRef: { current: (overrides.activeLocalId as string) ?? 'local-1' },
    mutationLockRef: { current: false },
    internalRef,
    setInternal: vi.fn() as Mock,
    initialInternalState: initial,
    getJwt: (overrides.getJwt as (() => string | null)) ?? (() => 'mock-jwt'),
    activeProjectSave: (overrides.activeProjectSave as (() => Promise<boolean>)) ?? vi.fn(async () => true),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (isCloudEnabled as Mock).mockReturnValue(true);
  (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: null });
});

describe('useProjectCloudOps', () => {
  describe('saveProjectToCloud', () => {
    it('delegates to activeProjectSave when localId is the active project', async () => {
      const activeProjectSave = vi.fn(async () => true);
      const deps = makeDeps({ activeProjectSave });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(activeProjectSave).toHaveBeenCalledOnce();
      // Should NOT read from localStorage or call the cloud API directly
      expect(loadProject).not.toHaveBeenCalled();
      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('propagates errors thrown by activeProjectSave', async () => {
      const activeProjectSave = vi.fn().mockRejectedValue(new Error('Network failure'));
      const deps = makeDeps({ activeProjectSave });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('local-1');
        }),
      ).rejects.toThrow('Network failure');
    });

    it('creates a new cloud project for non-active project', async () => {
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

      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudId: 'new-cloud',
        cloudSavedAt: '2026-01-01T00:00:00Z',
        storage: 'cloud',
      });
      // Should NOT update active project cloud state
      expect(setCloudUrl).not.toHaveBeenCalled();
      expect(deps.setInternal).not.toHaveBeenCalled();
    });

    it('updates an existing non-active cloud project', async () => {
      const deps = makeDeps({ activeLocalId: 'other-local' });
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
        storage: 'cloud',
      });
      expect(setCloudUrl).not.toHaveBeenCalled();
    });

    it('throws when non-active project not found locally', async () => {
      const deps = makeDeps({ activeLocalId: 'other-local' });
      (loadProject as Mock).mockReturnValue(null);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('missing');
        }),
      ).rejects.toThrow('Project not found.');
    });

    it('throws when cloud returns not-found for non-active project', async () => {
      const deps = makeDeps({ activeLocalId: 'other-local' });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({ kind: 'not-found' });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('local-1');
        }),
      ).rejects.toThrow('Cloud project not found on server.');
    });

    it('throws "Authentication required" for non-active project when getJwt returns null', async () => {
      const deps = makeDeps({ activeLocalId: 'other-local', getJwt: () => null, projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });
      (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: null });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('local-1');
        }),
      ).rejects.toThrow('Authentication required. Please sign in.');
    });

    it('throws when mutation lock is held for non-active save', async () => {
      const deps = makeDeps({ activeLocalId: 'other-local' });
      deps.mutationLockRef.current = true; // lock already held

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('local-1');
        }),
      ).rejects.toThrow('Another cloud operation is in progress');
    });

    it('skips when cloud is not enabled', async () => {
      const deps = makeDeps();
      (isCloudEnabled as Mock).mockReturnValue(false);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
      expect(deps.activeProjectSave).not.toHaveBeenCalled();
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
        storage: 'local',
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
        storage: 'local',
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
