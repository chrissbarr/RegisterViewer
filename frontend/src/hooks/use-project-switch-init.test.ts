import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useProjectSwitchInit } from './use-project-switch-init';
import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';
import { cleanBaseline } from '../utils/cloud-sync-reducer';
import type { ProjectListEntry } from '../types/project';
import type { ProjectDepartureSnapshot } from '../context/project-storage-context';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/cloud-operations', () => ({
  saveProjectToCloudImpl: vi.fn(),
}));

vi.mock('./use-cloud-freshness', () => ({
  checkAndPullFreshVersion: vi.fn(),
}));

vi.mock('../utils/cloud-utils', () => ({
  setCloudUrl: vi.fn(),
  clearCloudUrl: vi.fn(),
  withMutationLock: vi.fn(async (ref: { current: boolean }, fn: () => Promise<unknown>) => {
    if (ref.current) return { executed: false };
    ref.current = true;
    try {
      return { executed: true, result: await fn() };
    } finally {
      ref.current = false;
    }
  }),
}));

vi.mock('../utils/project-storage', () => ({
  buildProjectUrl: vi.fn((id: string) => `https://example.com/#/p/${id}`),
  loadProject: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  exportToObject: vi.fn(() => ({ version: 1, registers: [], values: {} })),
  deserializeState: vi.fn(() => ({
    registers: [],
    activeRegisterId: null,
    registerValues: {},
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
    addressUnitBits: 8,
  })),
}));

// ── Imports for mocked modules ───────────────────────────────────────

import { saveProjectToCloudImpl } from '../utils/cloud-operations';
import { checkAndPullFreshVersion } from './use-cloud-freshness';
import { loadProject } from '../utils/project-storage';
import { withMutationLock } from '../utils/cloud-utils';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_JWT = 'mock-jwt-token';
const PROJECT_A_LOCAL_ID = 'local-aaa';
const PROJECT_A_CLOUD_ID = 'cloud-aaa';
const PROJECT_B_LOCAL_ID = 'local-bbb';

function makeRef<T>(value: T): { current: T } {
  return { current: value };
}

function makeProjectEntry(overrides: Partial<ProjectListEntry> = {}): ProjectListEntry {
  return {
    localId: PROJECT_A_LOCAL_ID,
    cloudId: null,
    name: 'Project A',
    visibility: 'private',
    createdAt: '2024-01-01T00:00:00Z',
    localSavedAt: '2024-06-01T00:00:00Z',
    cloudSavedAt: null,
    storage: 'local',
    ...overrides,
  };
}

function makeDeparture(overrides: Partial<ProjectDepartureSnapshot> = {}): ProjectDepartureSnapshot {
  return {
    localId: PROJECT_A_LOCAL_ID,
    cloudId: PROJECT_A_CLOUD_ID,
    storage: 'cloud' as const,
    serverVersion: 2,
    cloudConflictVersion: null,
    cloudSavedAt: '2024-06-01T00:00:00Z',
    visibility: 'private' as const,
    sequence: 1,
    wasDirty: true,
    ...overrides,
  };
}

function buildDeps(overrides: Partial<ReturnType<typeof buildDefaultDeps>> = {}) {
  return { ...buildDefaultDeps(), ...overrides };
}

function buildDefaultDeps() {
  const internalRef = makeRef<InternalCloudSyncState>({ ...initialInternalState });
  const activeLocalIdRef = makeRef<string | null>(PROJECT_A_LOCAL_ID);
  const setInternal = vi.fn((updater) => {
    if (typeof updater === 'function') {
      const newState = updater(internalRef.current);
      internalRef.current = newState;
    }
  });

  const projectA = makeProjectEntry({
    localId: PROJECT_A_LOCAL_ID,
    cloudId: PROJECT_A_CLOUD_ID,
    storage: 'cloud',
    serverVersion: 2,
  });
  const projectB = makeProjectEntry({
    localId: PROJECT_B_LOCAL_ID,
    cloudId: null,
    name: 'Project B',
    storage: 'local',
  });

  const projects: ProjectListEntry[] = [projectA, projectB];

  return {
    core: { internalRef, activeLocalIdRef, setInternal },
    internalRef,
    activeLocalIdRef,
    setInternal,
    activeLocalId: PROJECT_A_LOCAL_ID as string | null,
    projects,
    projectsRef: makeRef<ProjectListEntry[]>(projects),
    syncTimerRef: makeRef<ReturnType<typeof setTimeout> | null>(null),
    dataVersionRef: makeRef(1),
    mutationLockRef: makeRef(false),
    getJwt: vi.fn((): string | null => TEST_JWT),
    lastFreshnessCheckRef: makeRef(0),
    updateCloudMetadata: vi.fn(),
    dispatch: vi.fn(),
    lastDeparture: null as ProjectDepartureSnapshot | null,
  };
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (checkAndPullFreshVersion as Mock).mockResolvedValue(undefined);
});

// ── Tests ────────────────────────────────────────────────────────────

describe('useProjectSwitchInit', () => {
  describe('best-effort save on project switch', () => {
    it('fires save when departing project is dirty and cloud-backed', async () => {
      const deps = buildDeps();
      // Set up: project A is cloud-backed, currently active
      // clean baseline differs from dataVersionRef (dirty)
      deps.internalRef.current = {
        ...initialInternalState,
        cloudId: PROJECT_A_CLOUD_ID,
        isOwner: true,
        baseline: cleanBaseline(0), // differs from dataVersionRef.current (1) => dirty
      };
      deps.lastDeparture = makeDeparture();

      (loadProject as Mock).mockReturnValue({
        localId: PROJECT_A_LOCAL_ID,
        state: { registers: [], activeRegisterId: null, registerValues: {} },
      });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: PROJECT_A_CLOUD_ID,
        timestamp: '2024-06-02T00:00:00Z',
        version: 3,
      });

      // Initial render with project A active
      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      // Switch to project B
      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      // Allow the fire-and-forget promise to settle
      await vi.waitFor(() => {
        expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
          expect.anything(),
          PROJECT_A_CLOUD_ID,
          TEST_JWT,
          2, // serverVersion from project entry
        );
      });

      // On success, updateCloudMetadata should be called
      await vi.waitFor(() => {
        expect(deps.updateCloudMetadata).toHaveBeenCalledWith(PROJECT_A_LOCAL_ID, {
          cloudSavedAt: '2024-06-02T00:00:00Z',
          serverVersion: 3,
          cloudConflictVersion: null,
          hasUnsyncedChanges: false,
        });
      });
    });

    it('skips save for local-only project', () => {
      const deps = buildDeps();
      // Make project A local-only (no cloudId)
      const localOnlyProject = makeProjectEntry({
        localId: PROJECT_A_LOCAL_ID,
        cloudId: null,
        storage: 'local',
      });
      deps.projects = [localOnlyProject, deps.projects[1]];
      deps.projectsRef.current = deps.projects;
      deps.internalRef.current = { ...initialInternalState, baseline: cleanBaseline(0) };

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('skips save when no JWT', () => {
      const deps = buildDeps();
      deps.getJwt.mockReturnValue(null);
      deps.internalRef.current = {
        ...initialInternalState,
        cloudId: PROJECT_A_CLOUD_ID,
        isOwner: true,
        baseline: cleanBaseline(0),
      };
      deps.lastDeparture = makeDeparture();

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('saves with unknown serverVersion when departing project has serverVersion: 0', async () => {
      const deps = buildDeps();
      // Project A has cloudId but serverVersion: 0
      const cloudProjectV0 = makeProjectEntry({
        localId: PROJECT_A_LOCAL_ID,
        cloudId: PROJECT_A_CLOUD_ID,
        storage: 'cloud',
        serverVersion: 0, // falsy — should prevent best-effort save
      });
      deps.projects = [cloudProjectV0, deps.projects[1]];
      deps.projectsRef.current = deps.projects;
      deps.internalRef.current = {
        ...initialInternalState,
        cloudId: PROJECT_A_CLOUD_ID,
        isOwner: true,
        baseline: cleanBaseline(0), // differs from dataVersionRef.current (1) => dirty
      };
      deps.lastDeparture = makeDeparture({ serverVersion: 0 });
      (loadProject as Mock).mockReturnValue({
        localId: PROJECT_A_LOCAL_ID,
        serverVersion: 0,
        state: { registers: [], activeRegisterId: null, registerValues: {} },
      });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: PROJECT_A_CLOUD_ID,
        timestamp: '2024-06-02T00:00:00Z',
        version: 1,
      });

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      await vi.waitFor(() => {
        expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
          expect.anything(),
          PROJECT_A_CLOUD_ID,
          TEST_JWT,
          undefined,
        );
      });
    });

    it('save failure does not block switch', async () => {
      const deps = buildDeps();
      deps.internalRef.current = {
        ...initialInternalState,
        cloudId: PROJECT_A_CLOUD_ID,
        isOwner: true,
        baseline: cleanBaseline(0),
      };
      deps.lastDeparture = makeDeparture();

      (loadProject as Mock).mockReturnValue({
        localId: PROJECT_A_LOCAL_ID,
        state: { registers: [], activeRegisterId: null, registerValues: {} },
      });
      (saveProjectToCloudImpl as Mock).mockRejectedValue(new Error('Network error'));

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      // Switch to project B - should not throw even though save fails
      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      // Wait for the rejected promise to settle
      await vi.waitFor(() => {
        expect(saveProjectToCloudImpl).toHaveBeenCalled();
      });

      // Switch proceeded - no error thrown, no crash
      // updateCloudMetadata should NOT have been called (save failed)
      expect(deps.updateCloudMetadata).not.toHaveBeenCalledWith(
        PROJECT_A_LOCAL_ID,
        expect.objectContaining({ cloudSavedAt: expect.any(String) }),
      );
    });

    it('keeps retrying while the mutation lock is held', async () => {
      vi.useFakeTimers();
      const deps = buildDeps();
      deps.mutationLockRef.current = true;
      deps.lastDeparture = makeDeparture();
      (loadProject as Mock).mockReturnValue({
        localId: PROJECT_A_LOCAL_ID,
        serverVersion: 2,
        state: { registers: [], activeRegisterId: null, registerValues: {} },
      });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: PROJECT_A_CLOUD_ID,
        timestamp: '2024-06-02T00:00:00Z',
        version: 3,
      });

      try {
        const { rerender } = renderHook(
          (props: { activeLocalId: string | null }) =>
            useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
          { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
        );

        rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

        await vi.advanceTimersByTimeAsync(1000);
        expect(saveProjectToCloudImpl).not.toHaveBeenCalled();

        deps.mutationLockRef.current = false;
        await vi.advanceTimersByTimeAsync(250);

        await vi.waitFor(() => {
          expect(saveProjectToCloudImpl).toHaveBeenCalled();
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it('stops retrying the departure save after the cap when the lock stays held', async () => {
      vi.useFakeTimers();
      const deps = buildDeps();
      deps.mutationLockRef.current = true; // lock permanently held
      deps.lastDeparture = makeDeparture();
      (loadProject as Mock).mockReturnValue({
        localId: PROJECT_A_LOCAL_ID,
        serverVersion: 2,
        state: { registers: [], activeRegisterId: null, registerValues: {} },
      });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: PROJECT_A_CLOUD_ID,
        timestamp: '2024-06-02T00:00:00Z',
        version: 3,
      });

      try {
        const { rerender } = renderHook(
          (props: { activeLocalId: string | null }) =>
            useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
          { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
        );

        rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

        // Advance well past the cap (20 × 250ms = 5000ms >> MAX_DEPARTURE_SAVE_RETRIES × 250ms)
        for (let i = 0; i < 20; i++) {
          await vi.advanceTimersByTimeAsync(250);
        }

        // withMutationLock attempts are bounded: 1 initial + MAX_DEPARTURE_SAVE_RETRIES (8) retries
        expect(withMutationLock).toHaveBeenCalledTimes(9);
      } finally {
        vi.useRealTimers();
      }
    });

    it('marks non-active switch-save conflicts for later recovery', async () => {
      const deps = buildDeps();
      deps.lastDeparture = makeDeparture();
      (loadProject as Mock).mockReturnValue({
        localId: PROJECT_A_LOCAL_ID,
        serverVersion: 2,
        state: { registers: [], activeRegisterId: null, registerValues: {} },
      });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'conflict',
        serverVersion: 9,
      });

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      await vi.waitFor(() => {
        expect(deps.updateCloudMetadata).toHaveBeenCalledWith(PROJECT_A_LOCAL_ID, {
          serverVersion: 9,
          cloudConflictVersion: 9,
          hasUnsyncedChanges: true,
        });
      });
    });

    it('keeps departing project marked unsynced when it changes during the background save', async () => {
      const deps = buildDeps();
      deps.lastDeparture = makeDeparture();
      (loadProject as Mock).mockImplementation((id: string) => {
        if (id !== PROJECT_A_LOCAL_ID) return null;
        const callsForProjectA = (loadProject as Mock).mock.calls.filter(([calledId]) => calledId === PROJECT_A_LOCAL_ID).length;
        return {
          localId: PROJECT_A_LOCAL_ID,
          serverVersion: 2,
          state: {
            registers: [],
            activeRegisterId: null,
            registerValues: callsForProjectA <= 2 ? {} : { reg: '0x1' },
          },
        };
      });
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: PROJECT_A_CLOUD_ID,
        timestamp: '2024-06-02T00:00:00Z',
        version: 3,
      });

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      await vi.waitFor(() => {
        expect(deps.updateCloudMetadata).toHaveBeenCalledWith(PROJECT_A_LOCAL_ID, {
          cloudSavedAt: '2024-06-02T00:00:00Z',
          serverVersion: 3,
          cloudConflictVersion: null,
          hasUnsyncedChanges: true,
        });
      });
    });

    it('does not overwrite a project that already has a stored conflict marker', async () => {
      const deps = buildDeps();
      deps.lastDeparture = makeDeparture({ serverVersion: 9 });
      (loadProject as Mock).mockReturnValue({
        localId: PROJECT_A_LOCAL_ID,
        serverVersion: 9,
        cloudConflictVersion: 9,
        state: { registers: [], activeRegisterId: null, registerValues: {} },
      });

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      await vi.waitFor(() => {
        expect(loadProject).toHaveBeenCalledWith(PROJECT_A_LOCAL_ID);
      });
      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });
  });

  describe('cleanup on project switch', () => {
    it('clears sync timer and resets freshness throttle on switch', () => {
      const deps = buildDeps();
      // Set up a pending timer and non-zero freshness check timestamp
      const mockTimer = setTimeout(() => {}, 10000);
      deps.syncTimerRef.current = mockTimer;
      deps.lastFreshnessCheckRef.current = Date.now();
      // Make project A local so no best-effort save complicates things
      const localProject = makeProjectEntry({
        localId: PROJECT_A_LOCAL_ID,
        cloudId: null,
        storage: 'local',
      });
      deps.projects = [localProject, deps.projects[1]];
      deps.projectsRef.current = deps.projects;

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      expect(deps.syncTimerRef.current).toBeNull();
      expect(deps.lastFreshnessCheckRef.current).toBe(0);

      clearTimeout(mockTimer);
    });
  });

  describe('cloud state initialization', () => {
    it('marks the incoming cloud project clean before running its freshness check', () => {
      const deps = buildDeps();
      deps.dataVersionRef.current = 4;
      const localProject = makeProjectEntry({
        localId: PROJECT_A_LOCAL_ID,
        cloudId: null,
        storage: 'local',
      });
      const incomingProject = makeProjectEntry({
        localId: PROJECT_B_LOCAL_ID,
        cloudId: PROJECT_A_CLOUD_ID,
        storage: 'cloud',
        serverVersion: 9,
      });
      deps.projects = [localProject, incomingProject];
      deps.projectsRef.current = deps.projects;
      (loadProject as Mock).mockImplementation((id: string) => id === PROJECT_B_LOCAL_ID
        ? {
            localId: PROJECT_B_LOCAL_ID,
            cloudId: PROJECT_A_CLOUD_ID,
            storage: 'cloud',
            serverVersion: 9,
            visibility: 'private',
            state: { registers: [], activeRegisterId: null, registerValues: {} },
          }
        : null);

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      // A clean incoming cloud project requests a baseline capture so the engine
      // snapshots the generation into a clean baseline (replaces needsVersionSync).
      // The awaiting-capture marker is `baseline:{untracked}` (S14a); the engine
      // would resolve it to clean(4) on its next tick.
      expect(deps.internalRef.current.baseline.kind).toBe('untracked');
      expect(checkAndPullFreshVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ knownVersion: 9 }),
      );
    });

    it('runs freshness with knownVersion 0 when incoming cloud project has no serverVersion', () => {
      const deps = buildDeps();
      const localProject = makeProjectEntry({
        localId: PROJECT_A_LOCAL_ID,
        cloudId: null,
        storage: 'local',
      });
      const incomingProject = makeProjectEntry({
        localId: PROJECT_B_LOCAL_ID,
        cloudId: PROJECT_A_CLOUD_ID,
        storage: 'cloud',
        serverVersion: null,
      });
      deps.projects = [localProject, incomingProject];
      deps.projectsRef.current = deps.projects;
      (loadProject as Mock).mockImplementation((id: string) => id === PROJECT_B_LOCAL_ID
        ? {
            localId: PROJECT_B_LOCAL_ID,
            cloudId: PROJECT_A_CLOUD_ID,
            storage: 'cloud',
            serverVersion: null,
            visibility: 'private',
            state: { registers: [], activeRegisterId: null, registerValues: {} },
          }
        : null);

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      expect(checkAndPullFreshVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ knownVersion: 0 }),
      );
    });

    it('treats stored unsynced cloud data as dirty and skips freshness pull', () => {
      const deps = buildDeps();
      deps.dataVersionRef.current = 4;
      const localProject = makeProjectEntry({
        localId: PROJECT_A_LOCAL_ID,
        cloudId: null,
        storage: 'local',
      });
      const incomingProject = makeProjectEntry({
        localId: PROJECT_B_LOCAL_ID,
        cloudId: PROJECT_A_CLOUD_ID,
        storage: 'cloud',
        serverVersion: 9,
        hasUnsyncedChanges: true,
      });
      deps.projects = [localProject, incomingProject];
      deps.projectsRef.current = deps.projects;
      (loadProject as Mock).mockImplementation((id: string) => id === PROJECT_B_LOCAL_ID
        ? {
            localId: PROJECT_B_LOCAL_ID,
            cloudId: PROJECT_A_CLOUD_ID,
            storage: 'cloud',
            serverVersion: 9,
            hasUnsyncedChanges: true,
            visibility: 'private',
            state: { registers: [], activeRegisterId: null, registerValues: {} },
          }
        : null);

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      // Stored unsynced changes stay dirty: the seed used a `dirty` baseline and
      // no baseline-capture request (REQUEST_BASELINE → untracked) is made.
      expect(deps.internalRef.current.baseline.kind).toBe('dirty');
      expect(checkAndPullFreshVersion).not.toHaveBeenCalled();
    });

    it('restores stored conflict state and skips freshness pull', () => {
      const deps = buildDeps();
      const localProject = makeProjectEntry({
        localId: PROJECT_A_LOCAL_ID,
        cloudId: null,
        storage: 'local',
      });
      const conflictedProject = makeProjectEntry({
        localId: PROJECT_B_LOCAL_ID,
        cloudId: PROJECT_A_CLOUD_ID,
        storage: 'cloud',
        serverVersion: 9,
        cloudConflictVersion: 9,
      });
      deps.projects = [localProject, conflictedProject];
      deps.projectsRef.current = deps.projects;
      (loadProject as Mock).mockImplementation((id: string) => id === PROJECT_B_LOCAL_ID
        ? {
            localId: PROJECT_B_LOCAL_ID,
            cloudId: PROJECT_A_CLOUD_ID,
            storage: 'cloud',
            serverVersion: 9,
            cloudConflictVersion: 9,
            visibility: 'private',
            state: { registers: [], activeRegisterId: null, registerValues: {} },
          }
        : null);

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      expect(deps.internalRef.current.conflict).toEqual({ serverVersion: 9 });
      expect(checkAndPullFreshVersion).not.toHaveBeenCalled();
    });
  });
});
