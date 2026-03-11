import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useActiveProjectCloudOps } from './use-active-project-cloud-ops';
import type { InternalCloudSyncState } from '../types/cloud-sync';
import type { AppState } from '../types/register';
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

vi.mock('../utils/cloud-operations', () => ({
  saveProjectToCloudImpl: vi.fn(),
  deleteProjectFromCloudImpl: vi.fn(),
  patchVisibilityImpl: vi.fn(),
}));

// Mock cloud-url but keep withMutationLock as a passthrough that uses the real implementation
vi.mock('../utils/cloud-url', async () => {
  const actual = await vi.importActual<typeof import('../utils/cloud-url')>('../utils/cloud-url');
  return {
    ...actual,
    setCloudUrl: vi.fn(),
    clearCloudUrl: vi.fn(),
  };
});

vi.mock('../utils/project-storage', () => ({
  buildProjectUrl: vi.fn((id: string) => `https://example.com/#/p/${id}`),
}));

vi.mock('../utils/storage', () => ({
  exportToObject: vi.fn(() => ({ version: 1, registers: [], values: {} })),
  serializeState: vi.fn(() => ({ registers: [], activeRegisterId: null, registerValues: {} })),
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
import { setCloudUrl, clearCloudUrl } from '../utils/cloud-url';
import { exportToObject } from '../utils/storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_LOCAL_ID = 'local-123';
const TEST_CLOUD_ID = 'cloud-abc';
const TEST_JWT = 'mock-jwt-token';
const TEST_TIMESTAMP = '2024-06-01T00:00:00Z';

const INITIAL_INTERNAL_STATE: InternalCloudSyncState = {
  cloudId: null,
  isOwner: false,
  storage: 'local',
  status: 'idle',
  error: null,
  shareUrl: null,
  lastCloudSavedAt: null,
  lastSavedVersion: 0,
  visibility: 'private',
};

function makeRef<T>(value: T): { current: T } {
  return { current: value };
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

  return {
    internalRef: makeRef<InternalCloudSyncState>({ ...INITIAL_INTERNAL_STATE }),
    appStateRef: makeRef<AppState>(appState),
    activeLocalIdRef: makeRef<string | null>(TEST_LOCAL_ID),
    dataVersionRef: makeRef(1),
    mutationLockRef: makeRef(false),
    needsVersionSyncRef: makeRef(false),
    setInternal: vi.fn((updater) => {
      // Support both direct value and updater function
      if (typeof updater === 'function') {
        updater(INITIAL_INTERNAL_STATE);
      }
    }),
    updateCloudMetadata: vi.fn(),
    createNewProject: vi.fn(() => 'new-local-id'),
    getJwt: vi.fn((): string | null => TEST_JWT),
    dispatch: vi.fn(),
    initialInternalState: { ...INITIAL_INTERNAL_STATE },
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
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.saveToCloud();
      });

      expect(returned).toBe(true);
      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        { version: 1, registers: [], values: {} },
        null, // no existing cloudId
        TEST_JWT,
      );
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudId: TEST_CLOUD_ID,
        cloudSavedAt: TEST_TIMESTAMP,
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
      };
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'updated',
        cloudId: TEST_CLOUD_ID,
        timestamp: TEST_TIMESTAMP,
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      expect(saveProjectToCloudImpl).toHaveBeenCalledWith(
        expect.anything(),
        TEST_CLOUD_ID, // existing cloudId passed for update
        TEST_JWT,
      );
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudSavedAt: TEST_TIMESTAMP,
      });
    });

    it('handles not-found response by clearing cloud metadata', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
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

    it('returns false when mutation lock is held', async () => {
      const deps = makeDefaultDeps();
      deps.mutationLockRef.current = true; // lock is already held

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.saveToCloud();
      });

      expect(returned).toBe(false);
      expect(saveProjectToCloudImpl).not.toHaveBeenCalled();
    });

    it('targets captured localId when active project changes during save', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
      };
      // Simulate project switch during the async save
      (saveProjectToCloudImpl as Mock).mockImplementation(async () => {
        deps.activeLocalIdRef.current = 'switched-project';
        return { kind: 'updated', cloudId: TEST_CLOUD_ID, timestamp: TEST_TIMESTAMP };
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

      // updateCloudMetadata should target the original project, not the switched one
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudSavedAt: TEST_TIMESTAMP,
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

      await act(async () => {
        await result.current.saveToCloud();
      });

      // internalRef should NOT have been updated with the error
      expect(deps.internalRef.current.error).toBeNull();
    });

    it('sets error state on failure', async () => {
      const deps = makeDefaultDeps();
      (saveProjectToCloudImpl as Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.saveToCloud();
      });

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
  });

  describe('fork', () => {
    it('creates a new cloud copy with null existingCloudId', async () => {
      const deps = makeDefaultDeps();
      (saveProjectToCloudImpl as Mock).mockResolvedValue({
        kind: 'created',
        cloudId: 'forked-cloud-id',
        timestamp: TEST_TIMESTAMP,
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
      });

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.fork();
      });

      expect(deps.createNewProject).toHaveBeenCalledWith('Test Project', expect.anything());
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith('new-local-id', {
        cloudId: 'forked-cloud-id',
        cloudSavedAt: TEST_TIMESTAMP,
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
  });

  describe('setVisibility', () => {
    it('patches visibility on server and updates metadata', async () => {
      const deps = makeDefaultDeps();
      deps.internalRef.current = {
        ...INITIAL_INTERNAL_STATE,
        cloudId: TEST_CLOUD_ID,
        isOwner: true,
        visibility: 'private',
      };
      (patchVisibilityImpl as Mock).mockResolvedValue(undefined);

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      await act(async () => {
        await result.current.setVisibility('unlisted');
      });

      expect(patchVisibilityImpl).toHaveBeenCalledWith(TEST_CLOUD_ID, 'unlisted', TEST_JWT);
      expect(deps.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, { visibility: 'unlisted' });
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

  describe('cloud disabled', () => {
    it('saveToCloud returns true without calling API when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      const deps = makeDefaultDeps();

      const { result } = renderHook(() => useActiveProjectCloudOps(deps));

      let returned: boolean | undefined;
      await act(async () => {
        returned = await result.current.saveToCloud();
      });

      expect(returned).toBe(true);
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
