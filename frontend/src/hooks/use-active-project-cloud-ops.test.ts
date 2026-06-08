import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useActiveProjectCloudOps } from './use-active-project-cloud-ops';
import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';
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

vi.mock('../utils/cloud-project-loader', () => ({
  fetchAndParseCloudProject: vi.fn(),
}));

vi.mock('../utils/cloud-freshness', () => ({
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
import { checkAndPullFreshVersion } from '../utils/cloud-freshness';
import { exportToObject } from '../utils/storage';
import { patchProjectState } from '../utils/project-storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_LOCAL_ID = 'local-123';
const TEST_CLOUD_ID = 'cloud-abc';
const TEST_JWT = 'mock-jwt-token';
const TEST_TIMESTAMP = '2024-06-01T00:00:00Z';

const INITIAL_INTERNAL_STATE: InternalCloudSyncState = { ...initialInternalState, lastSavedVersion: 0 };

function makeRef<T>(value: T): { current: T } {
  return { current: value };
}

function writeOk(): ProjectStorageWriteResult {
  return { ok: true, status: 'ok', evictedLocalIds: [] };
}

function makeDefaultDeps(overrides: Partial<ReturnType<typeof buildDeps>> = {}) {
  return { ...buildDeps(), ...overrides };
}

function buildDeps() {
  const appState = makeState({
    registers: [makeRegister({ id: 'reg-1' })],
    registerValues: { 'reg-1': 0xFFn },
    project: { title: 'Test Project' },
  });

  const internalRef = makeRef<InternalCloudSyncState>({ ...INITIAL_INTERNAL_STATE });
  const activeLocalIdRef = makeRef<string | null>(TEST_LOCAL_ID);
  const setInternal = vi.fn((updater) => {
    // Support both direct value and updater function
    if (typeof updater === 'function') {
      updater(INITIAL_INTERNAL_STATE);
    }
  });

  return {
    core: { internalRef, activeLocalIdRef, setInternal },
    // Expose refs at top level for test assertions
    internalRef,
    activeLocalIdRef,
    setInternal,
    appStateRef: makeRef<AppState>(appState),
    dataVersionRef: makeRef(1),
    mutationLockRef: makeRef(false),
    needsVersionSyncRef: makeRef(false),
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
      // setInternal should have been called with status 'saving' then with the created result
      expect(deps.setInternal).toHaveBeenCalled();
    });

    it('updates an existing cloud project', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        lastSavedVersion: 1,
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
        lastSavedVersion: 1,
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
      // setInternal should reset cloud state
      const lastCall = deps.setInternal.mock.calls.at(-1)![0];
      const stateUpdate = typeof lastCall === 'function' ? lastCall(deps.internalRef.current) : lastCall;
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
      // setInternal should NOT have been called with the timestamp update
      // because the active project changed (only the 'saving' status update runs)
      const setInternalCalls = deps.setInternal.mock.calls;
      const hasTimestampUpdate = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.lastCloudSavedAt === TEST_TIMESTAMP && state.status === 'idle';
      });
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

      // The hook writes error to internalRef and calls setInternal
      expect(deps.internalRef.current).toMatchObject({
        status: 'idle',
        error: 'Failed to save project.',
      });
      expect(deps.setInternal).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'idle',
          error: 'Failed to save project.',
        }),
      );
    });

    it('clean 409 (no local edits during save) auto-pulls server version', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        lastSavedVersion: 1,
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
      const setInternalCalls = deps.setInternal.mock.calls;
      const hasServerVersionUpdate = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.serverVersion === 5;
      });
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
        lastSavedVersion: 1,
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
        lastSavedVersion: 0,
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

      const setInternalCalls = deps.setInternal.mock.calls;
      const hasConflict = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.conflict?.serverVersion === 5;
      });
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
        lastSavedVersion: 0,
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

      const setInternalCalls = deps.setInternal.mock.calls;
      const hasConflict = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.conflict?.serverVersion === 5 && state.serverVersion === 5;
      });
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
        lastSavedVersion: 1,
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
        lastSavedVersion: 1,
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
      const setInternalCalls = deps.setInternal.mock.calls;
      const hasConflict = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.conflict?.serverVersion === 5;
      });
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
        lastSavedVersion: 1,
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

      // serverVersion should still be updated to 5 (from the first setInternal call)
      const setInternalCalls = deps.setInternal.mock.calls;
      const hasServerVersionUpdate = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.serverVersion === 5;
      });
      expect(hasServerVersionUpdate).toBe(true);

      // Conflict UX should be shown as fallback after pull failure
      const hasConflictFallback = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.conflict?.serverVersion === 5;
      });
      expect(hasConflictFallback).toBe(true);
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

      // setInternal should have been called with serverVersion: 3
      const setInternalCalls = deps.setInternal.mock.calls;
      const hasVersionUpdate = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.serverVersion === 3 && state.status === 'idle';
      });
      expect(hasVersionUpdate).toBe(true);
    });

    it('successful save marks only the request generation as saved when edits happen in flight', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        serverVersion: 2,
        lastSavedVersion: 0,
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

      const setInternalCalls = deps.setInternal.mock.calls;
      const hasCapturedGenerationUpdate = setInternalCalls.some((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
        return state.serverVersion === 3 && state.lastSavedVersion === 1;
      });
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
      // setInternal called with initial state (reset)
      expect(deps.setInternal).toHaveBeenCalledWith(expect.objectContaining({
        cloudId: null,
        isOwner: false,
        status: 'idle',
      }));
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
      // Optimistic update — setInternal is called with the new visibility
      expect(deps.setInternal).toHaveBeenCalled();
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

      // First call is the optimistic update to 'unlisted'
      const firstCall = deps.setInternal.mock.calls[0][0];
      const optimisticState = typeof firstCall === 'function' ? firstCall(INITIAL_INTERNAL_STATE) : firstCall;
      expect(optimisticState).toMatchObject({ visibility: 'unlisted' });

      // Second call reverts to 'private' and sets error
      const revertCall = deps.setInternal.mock.calls[1][0];
      const revertedState = typeof revertCall === 'function' ? revertCall(INITIAL_INTERNAL_STATE) : revertCall;
      expect(revertedState).toMatchObject({
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
      const lastCall = deps.setInternal.mock.calls.at(-1)![0];
      const revertedState = typeof lastCall === 'function' ? lastCall(INITIAL_INTERNAL_STATE) : lastCall;
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
      expect(deps.needsVersionSyncRef.current).toBe(true);
      // setInternal should reflect loaded state
      const lastSetCall = deps.setInternal.mock.calls.at(-1)![0];
      const loadedState = typeof lastSetCall === 'function' ? lastSetCall(INITIAL_INTERNAL_STATE) : lastSetCall;
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
      // setInternal should set error and clear cloudId
      const lastSetCall = deps.setInternal.mock.calls.at(-1)![0];
      const errorState = typeof lastSetCall === 'function' ? lastSetCall(INITIAL_INTERNAL_STATE) : lastSetCall;
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

      // setInternal should include serverVersion: 5
      const lastSetCall = deps.setInternal.mock.calls.at(-1)![0];
      const loadedState = typeof lastSetCall === 'function' ? lastSetCall(INITIAL_INTERNAL_STATE) : lastSetCall;
      expect(loadedState).toMatchObject({
        serverVersion: 5,
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
      // so the catch block must NOT have written error state to internalRef.
      // The initial reset sets cloudId=null and error=null — an error write would
      // set error to a non-null string.
      const errorCalls = deps.setInternal.mock.calls.filter((call) => {
        const arg = call[0];
        const state = typeof arg === 'function' ? arg(INITIAL_INTERNAL_STATE) : arg;
        return state?.error !== null && state?.error !== undefined;
      });
      expect(errorCalls).toHaveLength(0);
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
      const setInternalCallWithVersion = (deps.setInternal as Mock).mock.invocationCallOrder.findIndex(
        (_order, i) => {
          const arg = (deps.setInternal as Mock).mock.calls[i][0];
          const state = typeof arg === 'function' ? arg(deps.internalRef.current) : arg;
          return state?.serverVersion === 3;
        },
      );
      expect(setInternalCallWithVersion).toBeGreaterThanOrEqual(0);
      const setInternalOrder = (deps.setInternal as Mock).mock.invocationCallOrder[setInternalCallWithVersion];
      const patchProjectStateOrder = (patchProjectState as Mock).mock.invocationCallOrder[0];
      expect(setInternalOrder).toBeLessThan(patchProjectStateOrder);

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
