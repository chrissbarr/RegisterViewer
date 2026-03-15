import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useProjectSwitchInit } from './use-project-switch-init';
import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';
import type { ProjectListEntry } from '../types/project';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/cloud-operations', () => ({
  saveProjectToCloudImpl: vi.fn(),
}));

vi.mock('../utils/cloud-freshness', () => ({
  checkAndPullFreshVersion: vi.fn(),
}));

vi.mock('../utils/cloud-utils', () => ({
  setCloudUrl: vi.fn(),
  clearCloudUrl: vi.fn(),
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
import { checkAndPullFreshVersion } from '../utils/cloud-freshness';
import { loadProject } from '../utils/project-storage';

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
    needsVersionSyncRef: makeRef(false),
    syncTimerRef: makeRef<ReturnType<typeof setTimeout> | null>(null),
    dataVersionRef: makeRef(1),
    getJwt: vi.fn((): string | null => TEST_JWT),
    lastFreshnessCheckRef: makeRef(0),
    updateCloudMetadata: vi.fn(),
    dispatch: vi.fn(),
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
      // lastSavedVersion differs from dataVersionRef (dirty)
      deps.internalRef.current = {
        ...initialInternalState,
        cloudId: PROJECT_A_CLOUD_ID,
        isOwner: true,
        lastSavedVersion: 0, // differs from dataVersionRef.current (1) => dirty
      };

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
      deps.internalRef.current = { ...initialInternalState, lastSavedVersion: 0 };

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
        lastSavedVersion: 0,
      };

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('skips save when departing project has serverVersion: 0 (falsy guard)', () => {
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
        lastSavedVersion: 0, // differs from dataVersionRef.current (1) => dirty
      };

      const { rerender } = renderHook(
        (props: { activeLocalId: string | null }) =>
          useProjectSwitchInit({ ...deps, activeLocalId: props.activeLocalId }),
        { initialProps: { activeLocalId: PROJECT_A_LOCAL_ID } },
      );

      rerender({ activeLocalId: PROJECT_B_LOCAL_ID });

      // The `prevEntry.serverVersion` guard is falsy for 0, so save should NOT fire
      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('save failure does not block switch', async () => {
      const deps = buildDeps();
      deps.internalRef.current = {
        ...initialInternalState,
        cloudId: PROJECT_A_CLOUD_ID,
        isOwner: true,
        lastSavedVersion: 0,
      };

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
});
