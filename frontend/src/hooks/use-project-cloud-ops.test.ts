import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useProjectCloudOps } from './use-project-cloud-ops';

vi.mock('../utils/storage', () => ({
  exportToObject: vi.fn(() => ({ version: 1, registers: [] })),
  deserializeState: vi.fn(() => ({ registers: [], registerValues: {} })),
}));

vi.mock('../utils/api-client', () => ({
  isCloudEnabled: vi.fn(() => true),
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
}));

vi.mock('../utils/project-storage', () => ({
  loadProject: vi.fn(),
  buildProjectUrl: vi.fn((id: string) => `https://app/#/p/${id}`),
}));

vi.mock('../utils/cloud-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/cloud-utils')>();
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

import { isCloudEnabled, ApiError } from '../utils/api-client';
import { loadProject } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl } from '../utils/cloud-utils';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import type { ProjectListEntry } from '../types/project';
import { initialInternalState } from '../types/cloud-sync';

function makeInitialState() {
  return { ...initialInternalState };
}

function makeProjectList(entries: Array<{ localId: string; cloudId?: string | null; serverVersion?: number | null; storage?: 'local' | 'cloud' }>): ProjectListEntry[] {
  return entries.map(p => ({
    localId: p.localId,
    cloudId: p.cloudId ?? null,
    name: 'Test',
    visibility: 'private' as const,
    createdAt: '2026-01-01T00:00:00Z',
    localSavedAt: '2026-01-01T00:00:00Z',
    cloudSavedAt: null,
    serverVersion: p.serverVersion ?? null,
    storage: p.storage ?? ((p.cloudId ?? null) !== null ? 'cloud' as const : 'local' as const),
  }));
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const initial = makeInitialState();
  const internalRef = { current: overrides.internalState as typeof initial ?? initial };
  const activeLocalIdRef = { current: (overrides.activeLocalId as string) ?? 'local-1' };
  const setInternal = vi.fn() as Mock;
  const projects = (overrides.projects as ProjectListEntry[]) ?? makeProjectList([{ localId: 'local-1', cloudId: 'cloud-1' }]);
  return {
    core: { internalRef, activeLocalIdRef, setInternal },
    // Expose core fields at top level for test assertions
    internalRef,
    activeLocalIdRef,
    setInternal,
    updateCloudMetadata: vi.fn(() => ({ ok: true, status: 'ok', evictedLocalIds: [] })) as Mock,
    projectsRef: { current: projects },
    mutationLockRef: { current: false },
    getJwt: (overrides.getJwt as (() => string | null)) ?? (() => 'mock-jwt'),
    activeProjectSave: (overrides.activeProjectSave as (() => Promise<import('../types/cloud-sync').SaveOutcome>)) ?? vi.fn(async () => 'saved' as const),
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
      const activeProjectSave = vi.fn(async () => 'saved' as const);
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

    it('throws when activeProjectSave reports that the save did not complete', async () => {
      const activeProjectSave = vi.fn(async () => 'lock-held' as const);
      const deps = makeDeps({ activeProjectSave });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveProjectToCloud('local-1');
        }),
      ).rejects.toThrow('Failed to save active project to cloud.');
    });

    it('creates a new cloud project for non-active project', async () => {
      const deps = makeDeps({ activeLocalId: 'other-local', projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });
      (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: null });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: 'new-cloud',
        timestamp: '2026-01-01T00:00:00Z',
        version: 1,
      });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudId: 'new-cloud',
        cloudSavedAt: '2026-01-01T00:00:00Z',
        storage: 'cloud',
        serverVersion: 1,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
      // Should NOT update active project cloud state
      expect(setCloudUrl).not.toHaveBeenCalled();
      expect(deps.setInternal).not.toHaveBeenCalled();
    });

    it('updates an existing non-active cloud project', async () => {
      const deps = makeDeps({
        activeLocalId: 'other-local',
        projects: makeProjectList([{ localId: 'local-1', cloudId: 'cloud-1', serverVersion: 8 }]),
      });
      (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: 'cloud-1', serverVersion: 7 });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        timestamp: '2026-01-02T00:00:00Z',
        version: 9,
      });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        { version: 1, registers: [] },
        'cloud-1',
        'mock-jwt',
        8,
      );
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudSavedAt: '2026-01-02T00:00:00Z',
        storage: 'cloud',
        serverVersion: 9,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
      expect(setCloudUrl).not.toHaveBeenCalled();
    });

    it('creates a new cloud project instead of updating a saved local cloud-linked fork', async () => {
      const localForkEntry: ProjectListEntry = {
        ...makeProjectList([{ localId: 'local-1', cloudId: null }])[0],
        cloudId: 'shared-cloud',
        storage: 'local',
        serverVersion: 8,
      };
      const deps = makeDeps({
        activeLocalId: 'other-local',
        projects: [localForkEntry],
      });
      (loadProject as Mock).mockReturnValue({
        state: '{}',
        cloudId: 'shared-cloud',
        storage: 'local',
        serverVersion: 8,
      });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: 'new-owned-cloud',
        timestamp: '2026-01-03T00:00:00Z',
        version: 1,
      });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        { version: 1, registers: [] },
        null,
        'mock-jwt',
        undefined,
      );
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudId: 'new-owned-cloud',
        cloudSavedAt: '2026-01-03T00:00:00Z',
        storage: 'cloud',
        serverVersion: 1,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
    });

    it('uses stored serverVersion when manifest version is missing for non-active save', async () => {
      const deps = makeDeps({
        activeLocalId: 'other-local',
        projects: makeProjectList([{ localId: 'local-1', cloudId: 'cloud-1', serverVersion: null }]),
      });
      (loadProject as Mock).mockReturnValue({ state: '{}', cloudId: 'cloud-1', storage: 'cloud', serverVersion: 6 });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        timestamp: '2026-01-02T00:00:00Z',
        version: 7,
      });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveProjectToCloud('local-1');
      });

      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        { version: 1, registers: [] },
        'cloud-1',
        'mock-jwt',
        6,
      );
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
        await result.current.deleteProjectFromCloud('local-1');
      });

      expect(deleteProjectFromCloudImpl).toHaveBeenCalledWith('cloud-1', 'mock-jwt');
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        cloudId: null,
        visibility: 'private',
        cloudSavedAt: null,
        serverVersion: null,
        cloudConflictVersion: null,
        hasUnsyncedChanges: undefined,
        storage: 'local',
      });
    });

    it('clears cloud state when deleting active project', async () => {
      const internalState = { ...makeInitialState(), cloudId: 'cloud-1' };
      const deps = makeDeps({ internalState });
      (deleteProjectFromCloudImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteProjectFromCloud('local-1');
      });

      expect(clearCloudUrl).toHaveBeenCalled();
      expect(deps.setInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudId: null,
          isOwner: false,
          storage: 'local',
        }),
      );
    });

    it('does not clear cloud state when deleting non-active project', async () => {
      const deps = makeDeps(); // internalRef.current.cloudId is null (different from cloud-1)
      (deleteProjectFromCloudImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteProjectFromCloud('local-1');
      });

      expect(clearCloudUrl).not.toHaveBeenCalled();
    });

    it('throws when the mutation lock is held', async () => {
      const deps = makeDeps();
      deps.mutationLockRef.current = true;

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => { await result.current.deleteProjectFromCloud('local-1'); }),
      ).rejects.toThrow(/in progress/i);

      expect(deleteProjectFromCloudImpl).not.toHaveBeenCalled();
    });

    it('treats DELETE 404 as already-deleted and clears local cloud metadata', async () => {
      const deps = makeDeps();
      (deleteProjectFromCloudImpl as Mock).mockRejectedValue(new ApiError(404, { error: 'Project not found' }));

      const { result } = renderHook(() => useProjectCloudOps(deps));

      // must NOT throw
      await act(async () => { await result.current.deleteProjectFromCloud('local-1'); });

      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', expect.objectContaining({ cloudId: null, storage: 'local' }));
    });

    it('propagates non-404 ApiErrors from deleteProjectFromCloudImpl', async () => {
      const deps = makeDeps();
      (deleteProjectFromCloudImpl as Mock).mockRejectedValue(new ApiError(500, { error: 'Internal server error' }));

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await expect(
        act(async () => { await result.current.deleteProjectFromCloud('local-1'); }),
      ).rejects.toThrow('Internal server error');

      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });

    it('does not delete a saved local cloud-linked fork even when an owned placeholder has the same cloudId', async () => {
      const deps = makeDeps({
        activeLocalId: 'other-local',
        projects: makeProjectList([
          { localId: 'local-fork', cloudId: 'cloud-1', storage: 'local' },
          { localId: 'owned-placeholder', cloudId: 'cloud-1', storage: 'cloud' },
        ]),
      });
      (deleteProjectFromCloudImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteProjectFromCloud('local-fork');
      });

      expect(deleteProjectFromCloudImpl).not.toHaveBeenCalled();
      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });
  });

  describe('setProjectVisibility', () => {
    const PATCH_UPDATED_AT = '2024-09-09T09:09:09Z';

    it('patches visibility and advances cloudSavedAt to the PATCH updatedAt', async () => {
      const deps = makeDeps();
      // A visibility PATCH advances the server's updated_at; the by-localId path
      // must persist it immediately (A-9 parity with the active path) instead of
      // leaving cloudSavedAt stale until the next LIST sync.
      (patchVisibilityImpl as Mock).mockResolvedValue(PATCH_UPDATED_AT);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.setProjectVisibility('local-1', 'unlisted');
      });

      expect(patchVisibilityImpl).toHaveBeenCalledWith('cloud-1', 'unlisted', 'mock-jwt');
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('local-1', {
        visibility: 'unlisted',
        cloudSavedAt: PATCH_UPDATED_AT,
      });
    });

    it('updates internal state and advances cloudSavedAt when targeting active project', async () => {
      const deps = makeDeps({ activeLocalId: 'local-1' });
      (patchVisibilityImpl as Mock).mockResolvedValue(PATCH_UPDATED_AT);

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.setProjectVisibility('local-1', 'unlisted');
      });

      // setInternal is called with an updater function that sets visibility and
      // advances lastCloudSavedAt (active mirror parity with the by-localId write).
      expect(deps.setInternal).toHaveBeenCalledWith(expect.any(Function));
      const updater = (deps.setInternal as Mock).mock.calls[0][0] as (prev: Record<string, unknown>) => Record<string, unknown>;
      expect(updater({ visibility: 'private' })).toEqual({
        visibility: 'unlisted',
        lastCloudSavedAt: PATCH_UPDATED_AT,
      });
    });

    it('returns early when project has no cloudId', async () => {
      const deps = makeDeps({ projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.setProjectVisibility('local-1', 'unlisted');
      });

      expect(patchVisibilityImpl).not.toHaveBeenCalled();
    });

    it('returns early for saved local cloud-linked forks', async () => {
      const localForkEntry: ProjectListEntry = {
        ...makeProjectList([{ localId: 'local-1', cloudId: null }])[0],
        cloudId: 'shared-cloud',
        storage: 'local',
      };
      const deps = makeDeps({ projects: [localForkEntry] });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      await act(async () => {
        await result.current.setProjectVisibility('local-1', 'unlisted');
      });

      expect(patchVisibilityImpl).not.toHaveBeenCalled();
      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
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
        serverVersion: null,
        cloudConflictVersion: null,
        hasUnsyncedChanges: undefined,
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
      expect(deps.setInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          cloudId: null,
          isOwner: false,
          storage: 'local',
        }),
      );
    });

    it('does nothing when project has no cloudId', () => {
      const deps = makeDeps({ projects: makeProjectList([{ localId: 'local-1', cloudId: null }]) });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      act(() => {
        result.current.unlinkCloudProject('local-1');
      });

      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });

    it('does nothing for saved local cloud-linked forks', () => {
      const localForkEntry: ProjectListEntry = {
        ...makeProjectList([{ localId: 'local-1', cloudId: null }])[0],
        cloudId: 'shared-cloud',
        storage: 'local',
      };
      const deps = makeDeps({ projects: [localForkEntry] });

      const { result } = renderHook(() => useProjectCloudOps(deps));

      act(() => {
        result.current.unlinkCloudProject('local-1');
      });

      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
      expect(clearCloudUrl).not.toHaveBeenCalled();
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
