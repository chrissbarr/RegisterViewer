import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useActiveProjectCloudOps } from './use-active-project-cloud-ops';
import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';
import { cleanBaseline, cloudSyncReducer, type CloudSyncAction } from '../utils/cloud-sync-reducer';
import type { AppState } from '../types/register';
import type { ProjectStorageWriteResult } from '../utils/project-storage';
import { makeState, makeRegister } from '../test/helpers';
// ApiError import resolves to the mocked class — needed for instanceof checks in source
import { ApiError } from '../utils/api-client';

// ── Mocks ────────────────────────────────────────────────────────────

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

vi.mock('../utils/cloud-project-loader', async () => {
  // Keep the real ownership policy (decideStorageForFetched/isConfirmedNonOwner)
  // so P5's conservative storage decision is exercised end-to-end; only the
  // network fetch is stubbed.
  const actual = await vi.importActual<typeof import('../utils/cloud-project-loader')>('../utils/cloud-project-loader');
  return {
    ...actual,
    fetchAndParseCloudProject: vi.fn(),
  };
});

vi.mock('./use-cloud-freshness', () => ({
  checkAndPullFreshVersion: vi.fn(),
}));

vi.mock('../utils/cloud-operations', () => ({
  saveProjectToCloudImpl: vi.fn(),
  deleteProjectFromCloudImpl: vi.fn(),
  patchVisibilityImpl: vi.fn(),
}));

// Mock cloud-utils but keep withMutationLock as a passthrough that uses the real implementation
vi.mock('../utils/cloud-utils', async () => {
  const actual = await vi.importActual<typeof import('../utils/cloud-utils')>('../utils/cloud-utils');
  return {
    ...actual,
    setCloudUrl: vi.fn(),
    clearCloudUrl: vi.fn(),
  };
});

vi.mock('../utils/project-storage', () => ({
  buildProjectUrl: vi.fn((id: string) => `https://example.com/#/p/${id}`),
  patchProjectState: vi.fn(() => ({ ok: true, status: 'ok', evictedLocalIds: [] })),
}));

vi.mock('../utils/storage', () => ({
  exportToObject: vi.fn(() => ({ version: 1, registers: [], values: {} })),
  serializeState: vi.fn(() => ({ registers: [], activeRegisterId: null, registerValues: {} })),
  serializeImportResult: vi.fn((result: { registers: unknown[]; values: Record<string, bigint>; project?: unknown; addressUnitBits?: unknown }) => ({
    registers: result.registers,
    activeRegisterId: null,
    registerValues: {},
    project: result.project,
    addressUnitBits: result.addressUnitBits,
  })),
}));

vi.mock('../utils/friendly-error', () => ({
  friendlyErrorMessage: vi.fn((_err: unknown, fallback: string) => fallback),
}));

// Stub history.replaceState so it doesn't error in jsdom
vi.spyOn(history, 'replaceState').mockImplementation(() => {});

// ── Imports for mocked modules ───────────────────────────────────────

import { isCloudEnabled } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import { setCloudUrl, clearCloudUrl } from '../utils/cloud-utils';
import { checkAndPullFreshVersion } from './use-cloud-freshness';
import { exportToObject } from '../utils/storage';
import { patchProjectState } from '../utils/project-storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_LOCAL_ID = 'local-123';
const TEST_CLOUD_ID = 'cloud-abc';
const TEST_JWT = 'mock-jwt-token';
const TEST_TIMESTAMP = '2024-06-01T00:00:00Z';

const INITIAL_INTERNAL_STATE: InternalCloudSyncState = { ...initialInternalState, baseline: cleanBaseline(0) };

function makeRef<T>(value: T): { current: T } {
  return { current: value };
}

function writeOk(): ProjectStorageWriteResult {
  return { ok: true, status: 'ok', evictedLocalIds: [] };
}

function makeDefaultDeps(overrides: Partial<ReturnType<typeof buildDeps>> = {}) {
  return { ...buildDeps(), ...overrides };
}

/** The state produced by reducing a single dispatched action over `base`. */
function dispatchedState(deps: ReturnType<typeof makeDefaultDeps>, base: InternalCloudSyncState, callIndex: number): InternalCloudSyncState {
  const action = deps.cloudDispatch.mock.calls[callIndex][0] as CloudSyncAction;
  return cloudSyncReducer(base, action);
}

/** The states produced by reducing each dispatched action independently over `base`. */
function dispatchedStates(deps: ReturnType<typeof makeDefaultDeps>, base: InternalCloudSyncState): InternalCloudSyncState[] {
  return deps.cloudDispatch.mock.calls.map((call) => cloudSyncReducer(base, call[0] as CloudSyncAction));
}

function buildDeps() {
  const appState = makeState({
    registers: [makeRegister({ id: 'reg-1' })],
    registerValues: { 'reg-1': 0xFFn },
    project: { title: 'Test Project' },
  });

  const internalRef = makeRef<InternalCloudSyncState>({ ...INITIAL_INTERNAL_STATE });
  const activeLocalIdRef = makeRef<string | null>(TEST_LOCAL_ID);
  // Cloud-sync reducer dispatch (replaces the former setInternal shim). The mock
  // does not mutate internalRef — assertions reduce the dispatched action against
  // a chosen base state via `dispatchedState`/`dispatchedStates` below.
  const cloudDispatch = vi.fn<(action: CloudSyncAction) => void>();

  return {
    core: { internalRef, activeLocalIdRef, dispatch: cloudDispatch },
    // Expose refs at top level for test assertions
    internalRef,
    activeLocalIdRef,
    cloudDispatch,
    appStateRef: makeRef<AppState>(appState),
    dataVersionRef: makeRef(1),
    mutationLockRef: makeRef(false),
    lastFreshnessCheckRef: makeRef(0),
    updateCloudMetadata: vi.fn(() => writeOk()),
    createNewProject: vi.fn(() => 'new-local-id'),
    loadAsUnsaved: vi.fn(() => true),
    getJwt: vi.fn((): string | null => TEST_JWT),
    dispatch: vi.fn(),
  };
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (isCloudEnabled as Mock).mockReturnValue(true);
  (exportToObject as Mock).mockReturnValue({ version: 1, registers: [], values: {} });
});

// ── Tests ────────────────────────────────────────────────────────────

describe('useActiveProjectCloudOps', () => {
  describe('saveToCloud', () => {
    it('creates a new cloud project when no existing cloudId', async () => {
      const deps = makeDefaultDeps();
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: TEST_CLOUD_ID,
        timestamp: TEST_TIMESTAMP,
        version: 1,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      let returned: string | undefined;
      await act(async () => {
        returned = await result.current.saveToCloud();
      });

      expect(returned).toBe('created');
      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        { version: 1, registers: [], values: {} },
        null, // no existing cloudId
        TEST_JWT,
        undefined, // no serverVersion for new project
      );
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudId: TEST_CLOUD_ID,
        cloudSavedAt: TEST_TIMESTAMP,
        storage: 'cloud',
        serverVersion: 1,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
      expect(setCloudUrl).toHaveBeenCalledWith(TEST_CLOUD_ID);
      // Dispatched BEGIN_SAVE then MARK_CREATED.
      expect(deps.cloudDispatch).toHaveBeenCalledWith({ type: 'BEGIN_SAVE' });
      expect(deps.cloudDispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'MARK_CREATED', cloudId: TEST_CLOUD_ID }));
    });

    it('updates an existing cloud project', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(1),
      };
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: TEST_CLOUD_ID,
        timestamp: TEST_TIMESTAMP,
        version: 3,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        expect.anything(),
        TEST_CLOUD_ID, // existing cloudId passed for update
        TEST_JWT,
        2, // serverVersion passed for optimistic concurrency
      );
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudSavedAt: TEST_TIMESTAMP,
        serverVersion: 3,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
    });

    it('keeps local cloud data protected when edits arrive during a save', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(1),
      };
      (saveProjectToCloudImpl as Mock).mockImplementation(async () => {
        deps.dataVersionRef.current = 2;
        return {
          kind: 'updated',
          cloudId: TEST_CLOUD_ID,
          timestamp: TEST_TIMESTAMP,
          version: 3,
        };
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      expect(patchProjectState).toHaveBeenCalled();
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudSavedAt: TEST_TIMESTAMP,
        serverVersion: 3,
        cloudConflictVersion: null,
        hasUnsyncedChanges: true,
      });
    });

    it('handles not-found response by clearing cloud metadata', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        storage: 'cloud',
      };
      (saveProjectToCloudImpl as Mock).mockResolvedValue({ kind: 'not-found' });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudId: null,
        visibility: 'private',
        cloudSavedAt: null,
        serverVersion: null,
        cloudConflictVersion: null,
        hasUnsyncedChanges: undefined,
        storage: 'local',
      });
      expect(clearCloudUrl).toHaveBeenCalled();
      // The last dispatched action (NOT_FOUND_CLEARED) resets cloud identity.
      const stateUpdate = dispatchedState(deps, deps.internalRef.current, deps.cloudDispatch.mock.calls.length - 1);
      expect(stateUpdate).toMatchObject({
        cloudId: null,
        isOwner: false,
        status: 'idle',
        shareUrl: null,
        visibility: 'private',
      });
    });

    it('returns "lock-held" when mutation lock is held', async () => {
      const deps = makeDefaultDeps();
      deps.mutationLockRef.current = true; // lock is already held

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      let returned: string | undefined;
      await act(async () => {
        returned = await result.current.saveToCloud();
      });

      expect(returned).toBe('lock-held');
      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('targets captured localId when active project changes during save', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        storage: 'cloud',
      };
      // Simulate project switch during the async save
      (saveProjectToCloudImpl as Mock).mockImplementation(async () => {
        deps.activeLocalIdRef.current = 'switched-project';
        return { kind: 'updated', cloudId: TEST_CLOUD_ID, timestamp: TEST_TIMESTAMP, version: 2 };
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      // updateCloudMetadata should target the original project, not the switched one
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudSavedAt: TEST_TIMESTAMP,
        serverVersion: 2,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
      // No MARK_SAVED was dispatched because the active project changed (only the
      // 'saving' status update runs) — the resulting state never reaches the
      // idle+timestamp combination.
      const hasTimestampUpdate = dispatchedStates(deps, deps.internalRef.current).some(
        (state) => state.lastCloudSavedAt === TEST_TIMESTAMP && state.status === 'idle',
      );
      expect(hasTimestampUpdate).toBe(false);
    });

    it('skips error state when active project changes during failed save', async () => {
      const deps = makeDefaultDeps();
      (saveProjectToCloudImpl as Mock).mockImplementation(async () => {
        deps.activeLocalIdRef.current = 'switched-project';
        throw new Error('Network error');
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveToCloud();
        }),
      ).rejects.toThrow('Network error');

      // internalRef should NOT have been updated with the error
      expect(deps.internalRef.current.error).toBeNull();
    });

    it('sets error state on failure and re-throws', async () => {
      const deps = makeDefaultDeps();
      (saveProjectToCloudImpl as Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveToCloud();
        }),
      ).rejects.toThrow('Network error');

      // The hook writes error to internalRef (synchronous ref write) and dispatches OP_FAILED.
      expect(deps.internalRef.current).toMatchObject({
        status: 'idle',
        error: 'Failed to save project.',
      });
      expect(deps.cloudDispatch).toHaveBeenCalledWith({
        type: 'OP_FAILED',
        error: 'Failed to save project.',
      });
    });

    it('clean 409 (no local edits during save) auto-pulls server version', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(1),
      };
      // dataVersionRef stays at 1 throughout (no local edits during save)
      deps.dataVersionRef.current = 1;

      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'conflict',
        serverVersion: 5,
      });
      (checkAndPullFreshVersion as Mock).mockResolvedValue({ applied: true, serverVersion: 5 });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      // serverVersion should be updated to 5 from the 409 response
      const hasServerVersionUpdate = dispatchedStates(deps, deps.internalRef.current).some(
        (state) => state.serverVersion === 5,
      );
      expect(hasServerVersionUpdate).toBe(true);

      // checkAndPullFreshVersion should have been called with (ctx, call) two-arg signature
      expect(checkAndPullFreshVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          lastFreshnessCheckRef: deps.lastFreshnessCheckRef,
        }),
        expect.objectContaining({
          cloudId: TEST_CLOUD_ID,
          mode: 'pull-if-clean',
          expectedDataVersion: 1,
        }),
      );
      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });

    it('clean 409 passes shared lastFreshnessCheckRef (not a throwaway ref)', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(1),
      };
      deps.dataVersionRef.current = 1;

      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'conflict',
        serverVersion: 5,
      });
      (checkAndPullFreshVersion as Mock).mockResolvedValue({ applied: true, serverVersion: 5 });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      // checkAndPullFreshVersion should have been called with the shared lastFreshnessCheckRef
      expect(checkAndPullFreshVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          lastFreshnessCheckRef: deps.lastFreshnessCheckRef,
        }),
        expect.objectContaining({
          cloudId: TEST_CLOUD_ID,
          mode: 'pull-if-clean',
          expectedDataVersion: 1,
        }),
      );
    });

    it('already-dirty 409 shows conflict UX instead of auto-pulling server version', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(0),
      };
      deps.dataVersionRef.current = 1;

      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'conflict',
        serverVersion: 5,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      const hasConflict = dispatchedStates(deps, deps.internalRef.current).some(
        (state) => state.conflict?.serverVersion === 5,
      );
      expect(hasConflict).toBe(true);
      expect(checkAndPullFreshVersion).not.toHaveBeenCalled();
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        serverVersion: 5,
        cloudConflictVersion: 5,
        hasUnsyncedChanges: true,
      });
    });

    it('already-dirty 409 shows conflict UX for direct cloud URL with no localId', async () => {
      const deps = makeDefaultDeps();
      deps.activeLocalIdRef.current = null;
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(0),
      };
      deps.dataVersionRef.current = 1;

      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'conflict',
        serverVersion: 5,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      const hasConflict = dispatchedStates(deps, deps.internalRef.current).some(
        (state) => state.conflict?.serverVersion === 5 && state.serverVersion === 5,
      );
      expect(hasConflict).toBe(true);
      expect(checkAndPullFreshVersion).not.toHaveBeenCalled();
      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });

    it('clean 409 can pull for direct cloud URL with no localId', async () => {
      const deps = makeDefaultDeps();
      deps.activeLocalIdRef.current = null;
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(1),
      };
      deps.dataVersionRef.current = 1;

      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'conflict',
        serverVersion: 5,
      });
      (checkAndPullFreshVersion as Mock).mockResolvedValue({ applied: true, serverVersion: 5 });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      expect(checkAndPullFreshVersion).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          cloudId: TEST_CLOUD_ID,
          localId: null,
          mode: 'pull-if-clean',
          expectedDataVersion: 1,
        }),
      );
    });

    it('dirty 409 (local edits during save) shows conflict UX', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(1),
      };
      deps.dataVersionRef.current = 1;

      // Simulate user editing during the async save by incrementing dataVersionRef
      (saveProjectToCloudImpl as Mock).mockImplementation(async () => {
        deps.dataVersionRef.current = 2; // user edited while save was in flight
        return { kind: 'conflict', serverVersion: 5 };
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      // conflict should be set in internal state
      const hasConflict = dispatchedStates(deps, deps.internalRef.current).some(
        (state) => state.conflict?.serverVersion === 5,
      );
      expect(hasConflict).toBe(true);

      // checkAndPullFreshVersion should NOT be called (dirty path skips pull)
      expect(checkAndPullFreshVersion).not.toHaveBeenCalled();
    });

    it('409 then pull failure still updates serverVersion (livelock prevention)', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(1),
      };
      deps.dataVersionRef.current = 1;

      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'conflict',
        serverVersion: 5,
      });
      // Pull fails
      (checkAndPullFreshVersion as Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      // serverVersion should still be updated to 5 (from the first dispatch: CONFLICT_CLEAN)
      const states = dispatchedStates(deps, deps.internalRef.current);
      expect(states.some((state) => state.serverVersion === 5)).toBe(true);

      // Conflict UX should be shown as fallback after pull failure (SET_CONFLICT)
      expect(states.some((state) => state.conflict?.serverVersion === 5)).toBe(true);
    });

    it('passes undefined (not 0) when serverVersion is 0 (falsy coercion guard)', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 0, // falsy — should become undefined, not 0
      };
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: TEST_CLOUD_ID,
        timestamp: TEST_TIMESTAMP,
        version: 1,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        expect.anything(),
        TEST_CLOUD_ID,
        TEST_JWT,
        undefined, // NOT 0 — the `serverVersion > 0 ? serverVersion : undefined` guard
      );
    });

    it('successful save updates serverVersion', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
      };
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: TEST_CLOUD_ID,
        timestamp: TEST_TIMESTAMP,
        version: 3,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      // A dispatched action (MARK_SAVED) records serverVersion: 3 at idle status.
      const hasVersionUpdate = dispatchedStates(deps, deps.internalRef.current).some(
        (state) => state.serverVersion === 3 && state.status === 'idle',
      );
      expect(hasVersionUpdate).toBe(true);
    });

    it('successful save marks only the request generation as saved when edits happen in flight', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        baseline: cleanBaseline(0),
      };
      deps.dataVersionRef.current = 1;
      (saveProjectToCloudImpl as Mock).mockImplementation(async () => {
        deps.dataVersionRef.current = 2;
        return {
          kind: 'updated',
          cloudId: TEST_CLOUD_ID,
          timestamp: TEST_TIMESTAMP,
          version: 3,
        };
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      const hasCapturedGenerationUpdate = dispatchedStates(deps, deps.internalRef.current).some(
        (state) => state.serverVersion === 3 && state.baseline.kind === 'clean' && state.baseline.version === 1,
      );
      expect(hasCapturedGenerationUpdate).toBe(true);
    });
  });

  describe('fork', () => {
    it('creates a new cloud copy with null existingCloudId', async () => {
      const deps = makeDefaultDeps();
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: 'forked-cloud-id',
        timestamp: TEST_TIMESTAMP,
        version: 1,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.fork();
      });

      // fork always passes null as existingCloudId to create a new project
      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        expect.anything(),
        null,
        TEST_JWT,
      );
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudId: 'forked-cloud-id',
        cloudSavedAt: TEST_TIMESTAMP,
        storage: 'cloud',
        serverVersion: 1,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
      expect(setCloudUrl).toHaveBeenCalledWith('forked-cloud-id');
    });

    it('creates a local project when activeLocalIdRef is null (shared project fork)', async () => {
      const deps = makeDefaultDeps();
      deps.activeLocalIdRef.current = null; // no local project yet
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: 'forked-cloud-id',
        timestamp: TEST_TIMESTAMP,
        version: 1,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.fork();
      });

      expect(deps.createNewProject).toHaveBeenCalledWith('Test Project', expect.anything());
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('new-local-id', {
        cloudId: 'forked-cloud-id',
        cloudSavedAt: TEST_TIMESTAMP,
        storage: 'cloud',
        serverVersion: 1,
        cloudConflictVersion: null,
        hasUnsyncedChanges: false,
      });
    });
  });

  describe('deleteFromCloud', () => {
    it('deletes and clears cloud state', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        storage: 'cloud',
      };
      (deleteProjectFromCloudImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteFromCloud();
      });

      expect(deleteProjectFromCloudImpl).toHaveBeenCalledWith(TEST_CLOUD_ID, TEST_JWT);
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudId: null,
        visibility: 'private',
        cloudSavedAt: null,
        serverVersion: null,
        cloudConflictVersion: null,
        hasUnsyncedChanges: undefined,
        storage: 'local',
      });
      expect(clearCloudUrl).toHaveBeenCalled();
      // Dispatched LIFECYCLE_RESET, which resets to the frozen initial state.
      expect(deps.cloudDispatch).toHaveBeenCalledWith({ type: 'LIFECYCLE_RESET' });
      const resetState = dispatchedState(deps, deps.internalRef.current, deps.cloudDispatch.mock.calls.length - 1);
      expect(resetState).toMatchObject({ cloudId: null, isOwner: false, status: 'idle' });
    });

    it('does nothing when no cloudId exists', async () => {
      const deps = makeDefaultDeps();

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteFromCloud();
      });

      expect(deleteProjectFromCloudImpl).not.toHaveBeenCalled();
    });

    it('does not delete transient local cloud-source state', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        storage: 'local',
      };

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.deleteFromCloud();
      });

      expect(deleteProjectFromCloudImpl).not.toHaveBeenCalled();
      expect(deps.updateCloudMetadata).not.toHaveBeenCalled();
    });
  });

  describe('setVisibility', () => {
    const PATCH_UPDATED_AT = '2024-07-15T12:34:56Z';

    it('patches visibility on server and updates both visibility and cloudSavedAt metadata', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        visibility: 'private',
      };
      // patchVisibilityImpl now returns the server updatedAt so cloudSavedAt can
      // track server updated_at immediately (a visibility PATCH advances
      // updated_at without bumping version).
      (patchVisibilityImpl as Mock).mockResolvedValue(PATCH_UPDATED_AT);

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.setVisibility('unlisted');
      });

      expect(patchVisibilityImpl).toHaveBeenCalledWith(TEST_CLOUD_ID, 'unlisted', TEST_JWT);
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        visibility: 'unlisted',
        cloudSavedAt: PATCH_UPDATED_AT,
      });
      // Optimistic update — SET_VISIBILITY is dispatched with the new visibility.
      expect(deps.cloudDispatch).toHaveBeenCalledWith({ type: 'SET_VISIBILITY', visibility: 'unlisted' });
    });

    it('reverts visibility on failure', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        visibility: 'private',
      };
      (patchVisibilityImpl as Mock).mockRejectedValue(new Error('Server error'));

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.setVisibility('unlisted');
      });

      // First dispatch is the optimistic update to 'unlisted'.
      expect(dispatchedState(deps, INITIAL_INTERNAL_STATE, 0)).toMatchObject({ visibility: 'unlisted' });

      // Second dispatch reverts to 'private' and sets error.
      expect(dispatchedState(deps, INITIAL_INTERNAL_STATE, 1)).toMatchObject({
        visibility: 'private',
        error: 'Failed to update visibility.',
      });
    });

    it('reverts both visibility and cloudSavedAt atomically on a failed metadata write', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        visibility: 'private',
      };
      (patchVisibilityImpl as Mock).mockResolvedValue(PATCH_UPDATED_AT);
      // Local metadata write fails after a successful server PATCH.
      deps.updateCloudMetadata.mockReturnValue({ ok: false, status: 'unknown-error', evictedLocalIds: [] });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.setVisibility('unlisted');
      });

      // The revert must restore the previous visibility (no half-applied state
      // where visibility is reverted but cloudSavedAt advanced).
      const revertedState = dispatchedState(deps, INITIAL_INTERNAL_STATE, deps.cloudDispatch.mock.calls.length - 1);
      expect(revertedState).toMatchObject({
        visibility: 'private',
        error: 'Visibility changed on server, but local metadata could not be updated.',
      });
    });
  });

  describe('loadCloudProject', () => {
    it('fetches and imports project data', async () => {
      const deps = makeDefaultDeps();
      const mockRegisters = [makeRegister({ id: 'r1', name: 'CTRL' })];
      const mockValues = { r1: 42n };
      (fetchAndParseCloudProject as Mock).mockResolvedValue({
        registers: mockRegisters,
        values: mockValues,
        project: { title: 'Cloud Project' },
        addressUnitBits: 8,
        isOwner: true,
        updatedAt: TEST_TIMESTAMP,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.loadCloudProject(TEST_CLOUD_ID);
      });

      expect(fetchAndParseCloudProject).toHaveBeenCalledWith(TEST_CLOUD_ID, TEST_JWT);
      expect(deps.dispatch).toHaveBeenCalledWith({
        type: 'IMPORT_STATE',
        registers: mockRegisters,
        values: mockValues,
        project: { title: 'Cloud Project' },
        addressUnitBits: 8,
      });
      // A baseline-capture request is dispatched (replaces needsVersionSyncRef)
      // so the engine snapshots the baseline on its next effect tick. The marker
      // is now `baseline:{untracked}` (S14a).
      expect(deps.cloudDispatch).toHaveBeenCalledWith({ type: 'REQUEST_BASELINE' });
      // The last dispatch (LOAD_SUCCEEDED) reflects the loaded state.
      const loadedState = dispatchedState(deps, INITIAL_INTERNAL_STATE, deps.cloudDispatch.mock.calls.length - 1);
      expect(loadedState).toMatchObject({
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        status: 'idle',
        lastCloudSavedAt: TEST_TIMESTAMP,
      });
    });

    it('handles 404 gracefully', async () => {
      const deps = makeDefaultDeps();
      (fetchAndParseCloudProject as Mock).mockRejectedValue(
        new ApiError(404, { error: 'Not found' }),
      );

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.loadCloudProject(TEST_CLOUD_ID);
      });

      expect(deps.dispatch).not.toHaveBeenCalled();
      // The last dispatch (LOAD_FAILED) sets error and clears cloudId.
      const errorState = dispatchedState(deps, INITIAL_INTERNAL_STATE, deps.cloudDispatch.mock.calls.length - 1);
      expect(errorState).toMatchObject({
        status: 'idle',
        cloudId: null,
        error: expect.stringContaining('not found'),
      });
    });

    it('threads server version into internal state', async () => {
      const deps = makeDefaultDeps();
      (fetchAndParseCloudProject as Mock).mockResolvedValue({
        registers: [],
        values: {},
        project: { title: 'Versioned Project' },
        addressUnitBits: 8,
        isOwner: true,
        updatedAt: TEST_TIMESTAMP,
        version: 5,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.loadCloudProject(TEST_CLOUD_ID);
      });

      // The last dispatch (LOAD_SUCCEEDED) includes serverVersion: 5.
      const loadedState = dispatchedState(deps, INITIAL_INTERNAL_STATE, deps.cloudDispatch.mock.calls.length - 1);
      expect(loadedState).toMatchObject({
        serverVersion: 5,
      });
    });

    // ── P5 conservative ownership policy (S15) ────────────────────────
    // P5 routes the owned-vs-shared decision through decideStorageForFetched,
    // so it only demotes to 'local' on POSITIVE evidence of non-ownership
    // and trusts the manifest (cloud) when ownership is unknown.
    describe('conservative ownership policy', () => {
      function makeLoadResult(overrides: Record<string, unknown>) {
        return {
          registers: [makeRegister({ id: 'r1', name: 'CTRL' })],
          values: { r1: 1n },
          project: { title: 'Cloud Project' },
          addressUnitBits: 8,
          updatedAt: TEST_TIMESTAMP,
          version: 3,
          visibility: 'unlisted',
          ...overrides,
        };
      }

      function lastSeed(deps: ReturnType<typeof makeDefaultDeps>) {
        return dispatchedState(deps, INITIAL_INTERNAL_STATE, deps.cloudDispatch.mock.calls.length - 1);
      }

      it('authenticated owner → cloud storage (owned branch)', async () => {
        const deps = makeDefaultDeps();
        (fetchAndParseCloudProject as Mock).mockResolvedValue(
          makeLoadResult({ isOwner: true, authenticated: true }),
        );

        const { result } = renderHook(() => useActiveProjectCloudOps(deps));
        await act(async () => { await result.current.loadCloudProject(TEST_CLOUD_ID); });

        // Owned branch: a new local record is created and IMPORT_STATE dispatched.
        expect(deps.createNewProject).toHaveBeenCalled();
        expect(deps.loadAsUnsaved).not.toHaveBeenCalled();
        expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'IMPORT_STATE' }));
        expect(deps.updateCloudMetadata).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ storage: 'cloud' }),
        );
        expect(lastSeed(deps)).toMatchObject({ isOwner: true, storage: 'cloud' });
      });

      it('authenticated non-owner → demote to local (confirmed demotion preserved)', async () => {
        const deps = makeDefaultDeps();
        (fetchAndParseCloudProject as Mock).mockResolvedValue(
          makeLoadResult({ isOwner: false, authenticated: true }),
        );

        const { result } = renderHook(() => useActiveProjectCloudOps(deps));
        await act(async () => { await result.current.loadCloudProject(TEST_CLOUD_ID); });

        // Shared branch: opened as an unsaved workspace, no owned local record.
        expect(deps.loadAsUnsaved).toHaveBeenCalled();
        expect(deps.createNewProject).not.toHaveBeenCalled();
        expect(deps.dispatch).not.toHaveBeenCalled();
        expect(lastSeed(deps)).toMatchObject({ isOwner: false, storage: 'local' });
      });

      it('unknown ownership (missing/expired JWT) → trusts manifest, keeps cloud (NEW)', async () => {
        const deps = makeDefaultDeps();
        deps.getJwt.mockReturnValue(null);
        // isOwner:false with authenticated absent => ownership UNKNOWN, not
        // confirmed non-ownership. Pre-S15 code demoted on raw isOwner; the
        // conservative policy now keeps cloud storage (owned branch).
        (fetchAndParseCloudProject as Mock).mockResolvedValue(
          makeLoadResult({ isOwner: false }),
        );

        const { result } = renderHook(() => useActiveProjectCloudOps(deps));
        await act(async () => { await result.current.loadCloudProject(TEST_CLOUD_ID); });

        // NEW behavior: owned branch is taken — a cloud-backed local record is
        // created and IMPORT_STATE dispatched, rather than an unsaved fork.
        expect(deps.createNewProject).toHaveBeenCalled();
        expect(deps.loadAsUnsaved).not.toHaveBeenCalled();
        expect(deps.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'IMPORT_STATE' }));
        expect(deps.updateCloudMetadata).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ storage: 'cloud' }),
        );
        expect(lastSeed(deps)).toMatchObject({ storage: 'cloud' });
      });
    });

    it('passes jwt as undefined when not authenticated', async () => {
      const deps = makeDefaultDeps();
      deps.getJwt.mockReturnValue(null);
      (fetchAndParseCloudProject as Mock).mockResolvedValue({
        registers: [],
        values: {},
        project: { title: 'Public Project' },
        isOwner: false,
        updatedAt: TEST_TIMESTAMP,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.loadCloudProject(TEST_CLOUD_ID);
      });

      expect(fetchAndParseCloudProject).toHaveBeenCalledWith(TEST_CLOUD_ID, undefined);
    });
  });

  describe('zombie-write guard (isSameActiveSaveTarget cloudId check)', () => {
    it('does not paint error/conflict onto reset cloud state after sign-out mid-flight', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
      };

      // Simulate sign-out resetting cloud state mid-flight:
      // the save rejects with a 401-ish error, and by the time the catch runs,
      // the internalRef has been reset (cloudId = null, matching sign-out behaviour).
      (saveProjectToCloudImpl as Mock).mockImplementation(async () => {
        // Sign-out reset: clear the cloud state while the save is in flight
        deps.internalRef.current = { ...INITIAL_INTERNAL_STATE };
        throw new Error('Unauthorized');
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await expect(
        act(async () => {
          await result.current.saveToCloud();
        }),
      ).rejects.toThrow('Unauthorized');

      // isSameActiveSaveTarget now checks cloudId: null !== TEST_CLOUD_ID,
      // so the catch block must NOT have dispatched an error-setting action.
      // No OP_FAILED is dispatched (only BEGIN_SAVE, which leaves error null).
      const errorDispatches = dispatchedStates(deps, INITIAL_INTERNAL_STATE).filter(
        (state) => state.error !== null && state.error !== undefined,
      );
      expect(errorDispatches).toHaveLength(0);
    });
  });

  describe('SaveOutcome discriminated union', () => {
    it('returns "local-persist-failed" (not a retriable lock-held) when PUT succeeds but local persist fails', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = { ...INITIAL_INTERNAL_STATE, cloudId: TEST_CLOUD_ID, isOwner: true, storage: 'cloud', serverVersion: 2 };
      (saveProjectToCloudImpl as Mock).mockResolvedValue({ kind: 'updated', cloudId: TEST_CLOUD_ID, timestamp: TEST_TIMESTAMP, version: 3 });
      (patchProjectState as Mock).mockReturnValueOnce({ ok: false, status: 'quota-exceeded', evictedLocalIds: [] });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));
      let outcome: string | undefined;
      await act(async () => { outcome = await result.current.saveToCloud(); });

      expect(outcome).toBe('local-persist-failed');
      // Exactly one PUT — the failure path must not loop or re-PUT.
      expect(saveProjectToCloudImpl).toHaveBeenCalledTimes(1);

      // The serverVersion must be recorded BEFORE patchProjectState runs, so a
      // departure save reading from localStorage sees the confirmed version.
      // RECORD_SERVER_VERSION{serverVersion:3} is the version-recording dispatch.
      const dispatchIndexWithVersion = (deps.cloudDispatch as Mock).mock.calls.findIndex(
        (call) => {
          const action = call[0] as CloudSyncAction;
          return action.type === 'RECORD_SERVER_VERSION' && action.serverVersion === 3;
        },
      );
      expect(dispatchIndexWithVersion).toBeGreaterThanOrEqual(0);
      const dispatchOrder = (deps.cloudDispatch as Mock).mock.invocationCallOrder[dispatchIndexWithVersion];
      const patchProjectStateOrder = (patchProjectState as Mock).mock.invocationCallOrder[0];
      expect(dispatchOrder).toBeLessThan(patchProjectStateOrder);

      // Best-effort manifest write: the confirmed server version must be persisted
      // so the departure save can't re-PUT a stale version and manufacture a 409.
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, { serverVersion: 3 });
    });

    it('returns "saved" on a successful update and "lock-held" when the lock is busy', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = { ...INITIAL_INTERNAL_STATE, cloudId: TEST_CLOUD_ID, isOwner: true, storage: 'cloud', serverVersion: 2 };
      (saveProjectToCloudImpl as Mock).mockResolvedValue({ kind: 'updated', cloudId: TEST_CLOUD_ID, timestamp: TEST_TIMESTAMP, version: 3 });
      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      let outcome: string | undefined;
      await act(async () => { outcome = await result.current.saveToCloud(); });
      expect(outcome).toBe('saved');

      deps.mutationLockRef.current = true; // lock held
      await act(async () => { outcome = await result.current.saveToCloud(); });
      expect(outcome).toBe('lock-held');
    });
  });

  describe('cloud disabled', () => {
    it('saveToCloud returns "noop" without calling API when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      const deps = makeDefaultDeps();

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      let returned: string | undefined;
      await act(async () => {
        returned = await result.current.saveToCloud();
      });

      expect(returned).toBe('noop');
      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('fork does nothing when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      const deps = makeDefaultDeps();

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.fork();
      });

      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });
  });
});
