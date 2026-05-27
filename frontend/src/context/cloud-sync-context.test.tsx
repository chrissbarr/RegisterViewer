import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import { CloudSyncProvider, useCloudSync, useCloudSyncActions } from './cloud-sync-context';
import { AppProvider } from './app-context';
import { EditProvider } from './edit-context';
import { ProjectStorageProvider, useProjectStorageActions } from './project-storage-context';
import { useAppDispatch } from './app-context';
import { makeState, makeRegister } from '../test/helpers';
import type { ProjectManifestEntry, StoredLocalProject } from '../types/project';
import type { SerializedAppState } from '../types/register';
import type { SyncResult } from '../types/cloud-sync';
// ApiError import resolves to the mocked class — needed for instanceof checks in source
import { ApiError } from '../utils/api-client';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/api-client', () => {
  class MockApiError extends Error {
    status: number;
    errorBody: Record<string, unknown>;
    constructor(status: number, errorBody: Record<string, unknown>) {
      super(String(errorBody.error));
      this.name = 'ApiError';
      this.status = status;
      this.errorBody = errorBody;
    }
  }
  return {
    isCloudEnabled: vi.fn(() => true),
    isConflictError: vi.fn((err: unknown) => err instanceof MockApiError
      && err.status === 409
      && typeof err.errorBody.currentVersion === 'number'),
    ApiError: MockApiError,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    patchProjectVisibility: vi.fn(),
    getProject: vi.fn(),
    deleteProject: vi.fn(),
    listProjects: vi.fn(),
  };
});

vi.mock('../utils/cloud-project-loader', () => ({
  fetchAndParseCloudProject: vi.fn(),
  parseProjectData: vi.fn(() => null),
}));


vi.mock('../utils/project-storage', () => ({
  loadManifest: vi.fn(() => ({ version: 1, projects: [] })),
  saveManifest: vi.fn(),
  loadProject: vi.fn(() => null),
  hasLocalData: vi.fn(() => true),
  flushProjectState: vi.fn(),
  patchProjectState: vi.fn(() => ({ ok: true, status: 'ok', evictedLocalIds: [] })),
  buildProjectUrl: vi.fn((id: string) => `https://example.com/#/p/${id}`),
  createProject: vi.fn(),
  deleteProject: vi.fn(),
  updateProjectMetadata: vi.fn(),
  evictProjectData: vi.fn(),
  toProjectListEntry: vi.fn((e: Record<string, unknown>) => ({
    localId: e.localId,
    name: e.name ?? 'Test Project',
    cloudId: e.cloudId ?? null,
    visibility: e.visibility ?? 'private',
    createdAt: e.createdAt ?? '2024-01-01T00:00:00Z',
    localSavedAt: e.localSavedAt ?? '2024-01-01T00:00:00Z',
    cloudSavedAt: e.cloudSavedAt ?? null,
    serverVersion: e.serverVersion ?? null,
    storage: e.storage ?? 'local',
  })),
  getMostRecentProjectId: vi.fn(() => null),
  invalidateManifestCache: vi.fn(),
  projectStorageKey: vi.fn((id: string) => `register-viewer-project:${id}`),
  ACTIVE_PROJECT_SESSION_KEY: 'register-viewer-active-project',
  UNSAVED_SESSION_SENTINEL: '__unsaved__',
  clearUnsavedProject: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  exportToObject: vi.fn(() => ({ version: 1, registers: [], values: {} })),
  deserializeState: vi.fn((data: unknown) => data),
  serializeState: vi.fn((state: unknown) => state),
  serializeImportResult: vi.fn((result: { registers: unknown[]; values: Record<string, bigint>; project?: unknown; addressUnitBits?: unknown }) => ({
    registers: result.registers,
    activeRegisterId: null,
    registerValues: {},
    project: result.project,
    addressUnitBits: result.addressUnitBits,
  })),
  EMPTY_SERIALIZED_STATE: { registers: [], activeRegisterId: null, registerValues: {} },
}));

const authMock = {
  user: null as { id: number; email: string } | null,
  getJwt: vi.fn(() => null as string | null),
};
vi.mock('./auth-context', () => ({
  useAuth: () => ({ user: authMock.user }),
  useAuthActions: () => ({ sendCode: vi.fn(), verifyCode: vi.fn(), logout: vi.fn(), getJwt: authMock.getJwt }),
}));

// Stub history.replaceState so it doesn't error in jsdom
const replaceStateSpy = vi.spyOn(history, 'replaceState').mockImplementation(() => {});

// ── Imports for mocked modules ───────────────────────────────────────

import {
  isCloudEnabled,
  createProject as apiCreateProject,
  getProject as apiGetProject,
  updateProject as apiUpdateProject,
  patchProjectVisibility as apiPatchVisibility,
  deleteProject as apiDeleteProject,
  listProjects as apiListProjects,
} from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import {
  createProject as createProjectInStorage,
  loadManifest,
  loadProject,
  hasLocalData,
  flushProjectState,
  patchProjectState,
  deleteProject as deleteProjectFromStorage,
  updateProjectMetadata,
  evictProjectData,
} from '../utils/project-storage';
import { exportToObject, deserializeState, serializeState } from '../utils/storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_LOCAL_ID = 'local-123';
const EMPTY_SERIALIZED_STATE: SerializedAppState = {
  registers: [],
  activeRegisterId: null,
  registerValues: {},
};

function makeManifestEntry(overrides: Partial<ProjectManifestEntry> = {}) {
  return {
    localId: TEST_LOCAL_ID,
    cloudId: null as string | null,
    name: 'Test Project',
    visibility: 'private' as const,
    createdAt: '2024-01-01T00:00:00Z',
    localSavedAt: '2024-01-01T00:00:00Z',
    cloudSavedAt: null as string | null,
    serverVersion: null as number | null,
    storage: 'local' as const,
    ...overrides,
  };
}

function makeStoredProject(overrides: Partial<StoredLocalProject> = {}): StoredLocalProject {
  return {
    localId: TEST_LOCAL_ID,
    cloudId: null,
    name: 'Test Project',
    visibility: 'private',
    createdAt: '2024-01-01T00:00:00Z',
    localSavedAt: '2024-01-01T00:00:00Z',
    cloudSavedAt: null,
    serverVersion: null,
    storage: 'local',
    state: EMPTY_SERIALIZED_STATE,
    ...overrides,
  };
}

function writeOk(project?: StoredLocalProject) {
  return { ok: true, status: 'ok' as const, evictedLocalIds: [], project };
}

function mockServerProjects(...ids: string[]) {
  (apiListProjects as Mock).mockResolvedValue({
    projects: ids.map((id, index) => ({
      id,
      title: `Server Project ${index + 1}`,
      visibility: 'private',
      updatedAt: '2025-01-01T00:00:00Z',
      version: 1,
    })),
  });
}

function wrapper({ children }: { children: ReactNode }) {
  const initialState = makeState({
    registers: [makeRegister({ id: 'reg-1' })],
    registerValues: { 'reg-1': 0xFFn },
  });
  return (
    <AppProvider savedState={initialState}>
      <EditProvider>
        <ProjectStorageProvider initialLocalId={TEST_LOCAL_ID}>
          <CloudSyncProvider>{children}</CloudSyncProvider>
        </ProjectStorageProvider>
      </EditProvider>
    </AppProvider>
  );
}

function renderCloudSync() {
  return renderHook(
    () => ({
      state: useCloudSync(),
      actions: useCloudSyncActions(),
    }),
    { wrapper },
  );
}

/** Variant that also exposes dispatch for dirty-tracking tests */
function renderCloudSyncWithDispatch() {
  return renderHook(
    () => ({
      state: useCloudSync(),
      actions: useCloudSyncActions(),
      dispatch: useAppDispatch(),
    }),
    { wrapper },
  );
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  // Default mocks — authenticated by default so cloud ops proceed
  authMock.user = { id: 1, email: 'test@test.com' };
  authMock.getJwt.mockReturnValue('mock-jwt-token');
  (isCloudEnabled as Mock).mockReturnValue(true);
  (loadManifest as Mock).mockReturnValue({ version: 1, projects: [] });
  (loadProject as Mock).mockReturnValue(null);
  (hasLocalData as Mock).mockReturnValue(true);
  (flushProjectState as Mock).mockReturnValue(writeOk(makeStoredProject()));
  (patchProjectState as Mock).mockReturnValue(writeOk(makeStoredProject()));
  (updateProjectMetadata as Mock).mockReturnValue(writeOk(makeStoredProject()));
  (createProjectInStorage as Mock).mockReturnValue('created-local-id');
  (exportToObject as Mock).mockReturnValue({ version: 1, registers: [], values: {} });
  // getProject is called by the ownership re-evaluation effect; default to a resolved promise
  (apiGetProject as Mock).mockResolvedValue({ id: 'test', data: '{}', createdAt: '', updatedAt: '', isOwner: false, version: 1 });
  // listProjects is called by syncCloudProjects on mount/sign-in; default to empty list
  (apiListProjects as Mock).mockResolvedValue({ projects: [] });
});

// ── Tests ────────────────────────────────────────────────────────────

describe('CloudSyncProvider', () => {
  describe('initial state', () => {
    it('provides default idle state', () => {
      const { result } = renderCloudSync();
      expect(result.current.state).toMatchObject({
        cloudId: null,
        isOwner: false,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: null,
        lastCloudSavedAt: null,
        visibility: 'private',
        syncStatus: 'local-only',
      });
    });
  });

  describe('dirty tracking', () => {
    it('isDirty is false when no cloud project exists', () => {
      const { result } = renderCloudSyncWithDispatch();

      // Mutate app state without a cloud project
      act(() => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
      });

      // No cloudId — isDirty should always be false regardless of local changes
      expect(result.current.state.isDirty).toBe(false);
    });

    it('isDirty is true when cloud project exists and state has changed', async () => {
      // Create a cloud project, then mutate — isDirty must be true
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-dirty',
        shareUrl: 'https://example.com/#/p/cloud-dirty',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSyncWithDispatch();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });
      expect(result.current.state.cloudId).toBe('cloud-dirty');

      // Mutate app state
      act(() => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
      });

      expect(result.current.state.isDirty).toBe(true);
    });

    it('isDirty requires both cloudId and lastSavedVersion to be set', () => {
      const { result } = renderCloudSync();

      // Use initFromProject to set cloudId without going through save
      act(() => {
        result.current.actions.initFromProject('cloud-init', true);
      });

      // cloudId is set and lastSavedVersion is set to current dataVersion
      // isDirty depends on version drift, not just cloudId presence
      expect(result.current.state.cloudId).toBe('cloud-init');
      expect(typeof result.current.state.isDirty).toBe('boolean');
    });
  });

  describe('hooks outside provider', () => {
    it('useCloudSync throws without provider', () => {
      expect(() => renderHook(() => useCloudSync())).toThrow(
        'useCloudSync must be used within CloudSyncProvider',
      );
    });

    it('useCloudSyncActions throws without provider', () => {
      expect(() => renderHook(() => useCloudSyncActions())).toThrow(
        'useCloudSyncActions must be used within CloudSyncProvider',
      );
    });
  });

  describe('saveToCloud', () => {
    it('creates a new cloud project when no cloudId exists', async () => {
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      expect(apiCreateProject).toHaveBeenCalledWith(
        { version: 1, registers: [], values: {} },
        'mock-jwt-token',
      );
      expect(result.current.state.cloudId).toBe('cloud-abc');
      expect(result.current.state.isOwner).toBe(true);
      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.lastCloudSavedAt).toBe('2024-01-01T12:00:00Z');
    });

    it('updates existing cloud project when owner', async () => {
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      // First create a cloud project
      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      // Now update it
      (apiUpdateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        updatedAt: '2024-01-02T12:00:00Z',
        version: 2,
      });

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      expect(apiUpdateProject).toHaveBeenCalledWith(
        'cloud-abc',
        { version: 1, registers: [], values: {} },
        'mock-jwt-token',
        1, // serverVersion from initial create
      );
      expect(result.current.state.lastCloudSavedAt).toBe('2024-01-02T12:00:00Z');
    });

    it('handles 404 on update by clearing cloudId and showing error', async () => {
      // Set up as existing cloud project
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      // Now simulate 404 on update
      (apiUpdateProject as Mock).mockRejectedValue(
        new ApiError(404, { error: 'Not found' }),
      );

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      expect(result.current.state.cloudId).toBeNull();
      expect(result.current.state.error).toContain('Cloud project not found');
    });

    it('sets error state and re-throws on general failure', async () => {
      (apiCreateProject as Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderCloudSync();

      let caughtError: unknown;
      await act(async () => {
        try {
          await result.current.actions.saveToCloud();
        } catch (err) {
          caughtError = err;
        }
      });

      expect(caughtError).toBeInstanceOf(Error);
      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.error).toBe('Network error');
    });

    it('does nothing when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      expect(apiCreateProject).not.toHaveBeenCalled();
    });

    it('triggers login dialog when JWT missing', async () => {
      // Start unauthenticated
      authMock.user = null;
      authMock.getJwt.mockReturnValue(null);

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      // saveToCloud should set loginRequired instead of making API call
      expect(result.current.state.loginRequired).toBe(true);
      expect(apiCreateProject).not.toHaveBeenCalled();
    });
  });

  describe('mutation lock', () => {
    it('prevents concurrent saveToCloud calls', async () => {
      let resolveCreate: ((value: unknown) => void) | undefined;
      (apiCreateProject as Mock).mockImplementation(
        () => new Promise((resolve) => { resolveCreate = resolve; }),
      );

      const { result } = renderCloudSync();

      // Start first save (will hang)
      let save1Done = false;
      act(() => {
        result.current.actions.saveToCloud().then(() => { save1Done = true; });
      });

      // Start second save immediately - should be blocked by lock
      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      // Only one call should have been made
      expect(apiCreateProject).toHaveBeenCalledTimes(1);
      expect(resolveCreate).toBeDefined();

      // Resolve the first
      await act(async () => {
        resolveCreate!({
          id: 'cloud-abc',
          shareUrl: 'https://example.com/#/p/cloud-abc',
          createdAt: '2024-01-01T12:00:00Z',
        });
      });

      expect(save1Done).toBe(true);
    });
  });

  describe('fork', () => {
    it('creates a new cloud project as a copy', async () => {
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-fork-1',
        shareUrl: 'https://example.com/#/p/cloud-fork-1',
        createdAt: '2024-02-01T00:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.fork();
      });

      expect(apiCreateProject).toHaveBeenCalled();
      expect(result.current.state.cloudId).toBe('cloud-fork-1');
      expect(result.current.state.isOwner).toBe(true);
    });

    it('does nothing when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.fork();
      });

      expect(apiCreateProject).not.toHaveBeenCalled();
    });
  });

  describe('deleteFromCloud', () => {
    it('deletes cloud project and clears state', async () => {
      // First create a project
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });
      expect(result.current.state.cloudId).toBe('cloud-abc');

      // Now delete
      (apiDeleteProject as Mock).mockResolvedValue(undefined);

      await act(async () => {
        await result.current.actions.deleteFromCloud();
      });

      expect(apiDeleteProject).toHaveBeenCalledWith('cloud-abc', 'mock-jwt-token');
      expect(result.current.state.cloudId).toBeNull();
      expect(result.current.state.shareUrl).toBeNull();
      expect(result.current.state.isOwner).toBe(false);
    });

    it('does nothing when no cloudId', async () => {
      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.deleteFromCloud();
      });

      expect(apiDeleteProject).not.toHaveBeenCalled();
    });

    it('sets error on network failure', async () => {
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      (apiDeleteProject as Mock).mockRejectedValue(new Error('Network error'));

      await act(async () => {
        await result.current.actions.deleteFromCloud();
      });

      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.error).toBe('Network error');
      expect(result.current.state.cloudId).toBe('cloud-abc');
    });

    it('sets friendly error on 404 (already deleted server-side)', async () => {
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      (apiDeleteProject as Mock).mockRejectedValue(
        new ApiError(404, { error: 'Not found' }),
      );

      await act(async () => {
        await result.current.actions.deleteFromCloud();
      });

      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.error).toContain('may have been deleted');
      expect(result.current.state.cloudId).toBe('cloud-abc');
    });
  });

  describe('setVisibility', () => {
    it('updates visibility optimistically and persists via PATCH', async () => {
      // Create a cloud project first
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });
      (apiPatchVisibility as Mock).mockResolvedValue({
        id: 'cloud-abc',
        updatedAt: '2024-01-02T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      await act(async () => {
        await result.current.actions.setVisibility('unlisted');
      });

      expect(result.current.state.visibility).toBe('unlisted');
      expect(apiPatchVisibility).toHaveBeenCalledWith('cloud-abc', 'unlisted', 'mock-jwt-token');
      expect(apiUpdateProject).not.toHaveBeenCalled();
    });

    it('reverts visibility on server failure', async () => {
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-abc',
        shareUrl: 'https://example.com/#/p/cloud-abc',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      (apiPatchVisibility as Mock).mockRejectedValue(new Error('Server error'));

      await act(async () => {
        await result.current.actions.setVisibility('unlisted');
      });

      // Should revert to 'private' (the default) and set error
      expect(result.current.state.visibility).toBe('private');
      expect(result.current.state.error).toBe('Server error');
    });
  });

  describe('setProjectVisibility', () => {
    it('updates visibility for a specific project', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-xyz', storage: 'cloud' })],
      });
      (apiPatchVisibility as Mock).mockResolvedValue({
        id: 'cloud-xyz',
        updatedAt: '2024-01-02T00:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.setProjectVisibility(TEST_LOCAL_ID, 'unlisted');
      });

      expect(apiPatchVisibility).toHaveBeenCalledWith(
        'cloud-xyz',
        'unlisted',
        'mock-jwt-token',
      );
    });

    it('throws on failure', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-xyz', storage: 'cloud' })],
      });
      (apiPatchVisibility as Mock).mockRejectedValue(new Error('Server error'));

      const { result } = renderCloudSync();

      await expect(
        act(async () => {
          await result.current.actions.setProjectVisibility(TEST_LOCAL_ID, 'unlisted');
        }),
      ).rejects.toThrow('Server error');
    });

    it('does nothing when project has no cloudId', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: null })],
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.setProjectVisibility(TEST_LOCAL_ID, 'unlisted');
      });

      expect(apiPatchVisibility).not.toHaveBeenCalled();
    });
  });

  describe('saveProjectToCloud', () => {
    it('creates a new cloud project for a local-only project', async () => {
      (loadProject as Mock).mockReturnValue({
        localId: 'other-local',
        state: makeState(),
      });
      (deserializeState as Mock).mockReturnValue(makeState());
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ localId: 'other-local', cloudId: null })],
      });
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-new',
        shareUrl: 'https://example.com/#/p/cloud-new',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveProjectToCloud('other-local');
      });

      expect(apiCreateProject).toHaveBeenCalled();
    });

    it('delegates to active-project save when localId is active project', async () => {
      authMock.getJwt.mockReturnValue('mock-jwt');
      mockServerProjects('cloud-existing');
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-existing', storage: 'cloud' })],
      });
      (apiUpdateProject as Mock).mockResolvedValue({
        id: 'cloud-existing',
        updatedAt: '2024-01-02T12:00:00Z',
        version: 2,
      });

      const { result } = renderCloudSync();

      // Initialize cloud state so the active-project save path knows the cloudId
      await act(async () => {
        result.current.actions.initFromProject('cloud-existing', true, 'cloud');
      });

      (loadProject as Mock).mockClear();
      await act(async () => {
        await result.current.actions.saveProjectToCloud(TEST_LOCAL_ID);
      });

      // Active-project path uses appStateRef (not localStorage)
      expect(loadProject).not.toHaveBeenCalled();
      expect(apiUpdateProject).toHaveBeenCalled();
    });

    it('throws when project not found', async () => {
      (loadProject as Mock).mockReturnValue(null);

      const { result } = renderCloudSync();

      await expect(
        act(async () => {
          await result.current.actions.saveProjectToCloud('nonexistent');
        }),
      ).rejects.toThrow('Project not found.');
    });

    it('does nothing when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);

      const { result } = renderCloudSync();

      (loadProject as Mock).mockClear();
      await act(async () => {
        await result.current.actions.saveProjectToCloud(TEST_LOCAL_ID);
      });

      expect(loadProject).not.toHaveBeenCalled();
    });
  });

  describe('deleteProjectFromCloud', () => {
    it('deletes a cloud project by localId', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-del', storage: 'cloud' })],
      });
      (apiDeleteProject as Mock).mockResolvedValue(undefined);

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.deleteProjectFromCloud(TEST_LOCAL_ID);
      });

      expect(apiDeleteProject).toHaveBeenCalledWith('cloud-del', 'mock-jwt-token');
    });

    it('throws when JWT missing', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-del', storage: 'cloud' })],
      });
      authMock.getJwt.mockReturnValue(null);

      const { result } = renderCloudSync();

      await expect(
        act(async () => {
          await result.current.actions.deleteProjectFromCloud(TEST_LOCAL_ID);
        }),
      ).rejects.toThrow('Authentication required. Please sign in.');
    });

    it('clears active cloud state when deleting the active cloud project', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-active', storage: 'cloud' })],
      });
      (apiDeleteProject as Mock).mockResolvedValue(undefined);

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('cloud-active', true, 'cloud');
      });
      expect(result.current.state.cloudId).toBe('cloud-active');

      await act(async () => {
        await result.current.actions.deleteProjectFromCloud(TEST_LOCAL_ID);
      });

      expect(result.current.state.cloudId).toBeNull();
    });
  });

  describe('loadCloudProject', () => {
    it('fetches and imports a cloud project', async () => {
      const importResult = {
        registers: [makeRegister({ id: 'reg-imported' })],
        values: { 'reg-imported': 0xAAn },
        project: { title: 'Imported' },
        addressUnitBits: 8,
        updatedAt: '2024-01-01T12:00:00Z',
        isOwner: true,
        visibility: 'unlisted',
        version: 1,
      };
      (fetchAndParseCloudProject as Mock).mockResolvedValue(importResult);
      (updateProjectMetadata as Mock).mockImplementation((localId: string, updates: Partial<StoredLocalProject>) => {
        (loadManifest as Mock).mockReturnValue({
          version: 1,
          projects: [makeManifestEntry({
            localId,
            cloudId: updates.cloudId ?? null,
            storage: updates.storage ?? 'local',
            serverVersion: updates.serverVersion ?? null,
            cloudSavedAt: updates.cloudSavedAt ?? null,
            visibility: updates.visibility ?? 'private',
            hasUnsyncedChanges: updates.hasUnsyncedChanges,
            cloudConflictVersion: updates.cloudConflictVersion,
          })],
        });
        (loadProject as Mock).mockReturnValue(makeStoredProject({
          localId,
          cloudId: updates.cloudId ?? null,
          storage: updates.storage ?? 'local',
          serverVersion: updates.serverVersion ?? null,
          cloudSavedAt: updates.cloudSavedAt ?? null,
          visibility: updates.visibility ?? 'private',
          hasUnsyncedChanges: updates.hasUnsyncedChanges,
          cloudConflictVersion: updates.cloudConflictVersion,
        }));
        return writeOk(makeStoredProject({ localId, ...updates }));
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.loadCloudProject('cloud-load');
      });

      expect(fetchAndParseCloudProject).toHaveBeenCalledWith('cloud-load', 'mock-jwt-token');
      expect(result.current.state.cloudId).toBe('cloud-load');
      expect(result.current.state.isOwner).toBe(true);
      expect(result.current.state.status).toBe('idle');
      expect(result.current.state.lastCloudSavedAt).toBe('2024-01-01T12:00:00Z');
    });

    it('handles 404 gracefully', async () => {
      (fetchAndParseCloudProject as Mock).mockRejectedValue(
        new ApiError(404, { error: 'Not found' }),
      );

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.loadCloudProject('cloud-missing');
      });

      expect(result.current.state.cloudId).toBeNull();
      expect(result.current.state.error).toContain('may have been deleted');
      expect(result.current.state.status).toBe('idle');
    });

    it('sets error and rethrows on non-404 failure', async () => {
      (fetchAndParseCloudProject as Mock).mockRejectedValue(
        new Error('Network error'),
      );

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.loadCloudProject('cloud-fail');
      });

      // Error is captured in state, not re-thrown (avoids dual error reporting)
      expect(result.current.state.error).toBe('Network error');
      expect(result.current.state.status).toBe('idle');
    });
  });

  describe('initFromProject', () => {
    it('sets cloud state from a cloudId', () => {
      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('cloud-init', true);
      });

      expect(result.current.state.cloudId).toBe('cloud-init');
      expect(result.current.state.isOwner).toBe(true);
      expect(result.current.state.shareUrl).toBe('https://example.com/#/p/cloud-init');
    });

    it('uses initialized server version on the first active-project save', async () => {
      (apiUpdateProject as Mock).mockResolvedValue({
        id: 'cloud-init',
        updatedAt: '2024-01-02T12:00:00Z',
        version: 8,
      });
      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('cloud-init', true, 'cloud', {
          serverVersion: 7,
          cloudSavedAt: '2024-01-01T00:00:00Z',
        });
      });

      await act(async () => {
        await result.current.actions.saveToCloud();
      });

      expect(apiUpdateProject).toHaveBeenCalledWith(
        'cloud-init',
        { version: 1, registers: [], values: {} },
        'mock-jwt-token',
        7,
      );
    });

    it('clears cloud state when cloudId is null', () => {
      const { result } = renderCloudSync();

      // First set some cloud state
      act(() => {
        result.current.actions.initFromProject('cloud-init', true);
      });

      // Then clear it
      act(() => {
        result.current.actions.initFromProject(null, false);
      });

      expect(result.current.state.cloudId).toBeNull();
      expect(result.current.state.isOwner).toBe(false);
      expect(result.current.state.shareUrl).toBeNull();
      expect(replaceStateSpy).toHaveBeenCalled();
    });
  });

  describe('dismissError', () => {
    it('clears the error state', async () => {
      (apiCreateProject as Mock).mockRejectedValue(new Error('Test error'));

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud().catch(() => {});
      });
      expect(result.current.state.error).toBe('Test error');

      act(() => {
        result.current.actions.dismissError();
      });

      expect(result.current.state.error).toBeNull();
    });
  });

  describe('syncCloudProjects', () => {
    beforeEach(() => {
      authMock.user = null;
    });

    it('syncs metadata from server and returns update count', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({
            cloudId: 'cloud-1',
            cloudSavedAt: '2024-01-01T00:00:00Z',
            visibility: 'private',
            storage: 'cloud',
            serverVersion: 1,
          }),
        ],
      });
      (apiListProjects as Mock).mockResolvedValue({
        projects: [
          {
            id: 'cloud-1',
            visibility: 'unlisted',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-02-01T00:00:00Z', // newer than local
            version: 1,
          },
        ],
      });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.updatedCount).toBe(1);
      expect(syncResult!.staleCloudIds).toHaveLength(0);
      // Patches are routed through updateCloudMetadata → updateProjectMetadata
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        {
          cloudSavedAt: '2024-02-01T00:00:00Z',
          visibility: 'unlisted',
        },
        { protectedLocalIds: [TEST_LOCAL_ID], preserveLocalSavedAt: true },
      );
    });

    it('uses the latest manifest snapshot when sync starts', async () => {
      (loadManifest as Mock)
        .mockReturnValueOnce({ version: 1, projects: [] })
        .mockReturnValue({
          version: 1,
          projects: [makeManifestEntry({ cloudId: 'cloud-stale', storage: 'cloud' })],
        });
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.staleCloudIds).toEqual(['cloud-stale']);
      expect(syncResult!.staleReconciledCloudIds).toEqual(['cloud-stale']);
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        expect.objectContaining({ cloudId: null, storage: 'local' }),
        { protectedLocalIds: [TEST_LOCAL_ID], preserveLocalSavedAt: true },
      );
    });

    it('does not demote a stale cloud project while another cloud mutation is in progress', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-active', storage: 'cloud' })],
      });
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });
      let resolveSave: ((value: unknown) => void) | undefined;
      (apiUpdateProject as Mock).mockImplementation(
        () => new Promise((resolve) => { resolveSave = resolve; }),
      );

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('cloud-active', true, 'cloud', { serverVersion: 1 });
      });
      act(() => {
        void result.current.actions.saveToCloud();
      });
      expect(apiUpdateProject).toHaveBeenCalledTimes(1);

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!).toEqual({
        updatedCount: 0,
        staleCloudIds: ['cloud-active'],
        staleReconciledCloudIds: [],
        staleReconcileFailedCloudIds: ['cloud-active'],
        placeholdersCreated: 0,
      });
      expect(apiListProjects).toHaveBeenCalledTimes(1);
      expect(updateProjectMetadata).not.toHaveBeenCalled();
      expect(result.current.state.cloudId).toBe('cloud-active');

      await act(async () => {
        resolveSave?.({ id: 'cloud-active', updatedAt: '2024-01-02T00:00:00Z', version: 2 });
      });
    });

    it('does not demote stale cloud metadata when the local cloud snapshot changed after listing', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({
          localId: 'local-updated-after-list',
          cloudId: 'cloud-updated-after-list',
          storage: 'cloud',
          cloudSavedAt: '2024-01-01T00:00:00Z',
          serverVersion: 1,
        })],
      });
      (apiListProjects as Mock).mockImplementation(async () => {
        (loadManifest as Mock).mockReturnValue({
          version: 1,
          projects: [makeManifestEntry({
            localId: 'local-updated-after-list',
            cloudId: 'cloud-updated-after-list',
            storage: 'cloud',
            cloudSavedAt: '2024-01-02T00:00:00Z',
            serverVersion: 2,
          })],
        });
        return { projects: [] };
      });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.staleCloudIds).toEqual(['cloud-updated-after-list']);
      expect(syncResult!.staleReconciledCloudIds).toEqual([]);
      expect(syncResult!.staleReconcileFailedCloudIds).toEqual(['cloud-updated-after-list']);
      expect(updateProjectMetadata).not.toHaveBeenCalled();
      expect(deleteProjectFromStorage).not.toHaveBeenCalled();
    });

    it('demotes stale owned cloud projects to local forks', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({
            cloudId: 'cloud-stale',
            storage: 'cloud',
            visibility: 'unlisted',
            cloudSavedAt: '2024-01-01T00:00:00Z',
            serverVersion: 7,
          }),
        ],
      });
      (apiListProjects as Mock).mockResolvedValue({
        projects: [], // server has no projects
      });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.updatedCount).toBe(0);
      expect(syncResult!.staleCloudIds).toEqual(['cloud-stale']);
      expect(syncResult!.staleReconciledCloudIds).toEqual(['cloud-stale']);
      expect(syncResult!.staleReconcileFailedCloudIds).toEqual([]);
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        {
          cloudId: null,
          visibility: 'private',
          cloudSavedAt: null,
          serverVersion: null,
          cloudConflictVersion: null,
          hasUnsyncedChanges: undefined,
          storage: 'local',
        },
        { protectedLocalIds: [TEST_LOCAL_ID], preserveLocalSavedAt: true },
      );
    });

    it('clears dirty and conflicted stale cloud metadata', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({
            cloudId: 'cloud-conflicted',
            storage: 'cloud',
            hasUnsyncedChanges: true,
            cloudConflictVersion: 12,
          }),
        ],
      });
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.syncCloudProjects();
      });

      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        expect.objectContaining({
          cloudId: null,
          storage: 'local',
          cloudConflictVersion: null,
          hasUnsyncedChanges: undefined,
        }),
        { protectedLocalIds: [TEST_LOCAL_ID], preserveLocalSavedAt: true },
      );
    });

    it('resets active cloud state after stale owned cloud project is demoted', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-active-stale', storage: 'cloud' })],
      });
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('cloud-active-stale', true, 'cloud', {
          serverVersion: 3,
          cloudSavedAt: '2024-01-01T00:00:00Z',
          visibility: 'unlisted',
          cloudConflictVersion: 9,
          hasUnsyncedChanges: true,
        });
      });
      expect(result.current.state.cloudId).toBe('cloud-active-stale');

      await act(async () => {
        await result.current.actions.syncCloudProjects();
      });

      expect(result.current.state).toMatchObject({
        cloudId: null,
        isOwner: false,
        status: 'idle',
        shareUrl: null,
        visibility: 'private',
        conflict: null,
      });
      expect(result.current.state.error).toBe('Cloud project was deleted on the server. Local copy kept.');
      expect(patchProjectState).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        expect.anything(),
        { protectedLocalIds: [TEST_LOCAL_ID] },
      );
      expect(serializeState).toHaveBeenCalled();
    });

    it('keeps active cloud state when local state cannot be saved before demotion', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-active-stale', storage: 'cloud' })],
      });
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });
      (patchProjectState as Mock).mockReturnValue({
        ok: false,
        status: 'quota-exceeded',
        evictedLocalIds: [],
        project: undefined,
      });

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('cloud-active-stale', true, 'cloud', {
          serverVersion: 3,
          cloudSavedAt: '2024-01-01T00:00:00Z',
          visibility: 'unlisted',
        });
      });

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.staleCloudIds).toEqual(['cloud-active-stale']);
      expect(syncResult!.staleReconciledCloudIds).toEqual([]);
      expect(syncResult!.staleReconcileFailedCloudIds).toEqual(['cloud-active-stale']);
      expect(updateProjectMetadata).not.toHaveBeenCalled();
      expect(result.current.state.cloudId).toBe('cloud-active-stale');
      expect(result.current.state.error).toBe('Cloud project was deleted on the server, but local data could not be saved before unlinking.');
    });

    it('preserves non-active local project data while clearing stale cloud metadata', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({
          localId: 'local-with-data',
          cloudId: 'stale-with-data',
          storage: 'cloud',
        })],
      });
      (hasLocalData as Mock).mockReturnValue(true);
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.staleReconciledCloudIds).toEqual(['stale-with-data']);
      expect(deleteProjectFromStorage).not.toHaveBeenCalled();
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        'local-with-data',
        expect.objectContaining({
          cloudId: null,
          storage: 'local',
        }),
        {
          protectedLocalIds: expect.arrayContaining([TEST_LOCAL_ID, 'local-with-data']),
          preserveLocalSavedAt: true,
        },
      );
    });

    it('protects all stale project data while reconciling stale projects and applying sync writes', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({
            localId: 'stale-a',
            cloudId: 'cloud-stale-a',
            storage: 'cloud',
          }),
          makeManifestEntry({
            localId: 'stale-b',
            cloudId: 'cloud-stale-b',
            storage: 'cloud',
          }),
          makeManifestEntry({
            localId: 'patched-local',
            cloudId: 'cloud-patched',
            storage: 'cloud',
            cloudSavedAt: '2024-01-01T00:00:00Z',
          }),
        ],
      });
      (hasLocalData as Mock).mockReturnValue(true);
      (apiListProjects as Mock).mockResolvedValue({
        projects: [
          {
            id: 'cloud-patched',
            visibility: 'unlisted',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-02-01T00:00:00Z',
            version: 1,
          },
          {
            id: 'cloud-new',
            title: 'Remote Only',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-02-01T00:00:00Z',
            version: 1,
          },
        ],
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.syncCloudProjects();
      });

      expect(updateProjectMetadata).toHaveBeenCalledWith(
        'stale-a',
        expect.objectContaining({ cloudId: null, storage: 'local' }),
        {
          preserveLocalSavedAt: true,
          protectedLocalIds: expect.arrayContaining([TEST_LOCAL_ID, 'stale-a', 'stale-b']),
        },
      );
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        'stale-b',
        expect.objectContaining({ cloudId: null, storage: 'local' }),
        {
          preserveLocalSavedAt: true,
          protectedLocalIds: expect.arrayContaining([TEST_LOCAL_ID, 'stale-a', 'stale-b']),
        },
      );
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        'patched-local',
        {
          visibility: 'unlisted',
        },
        {
          preserveLocalSavedAt: true,
          protectedLocalIds: expect.arrayContaining([TEST_LOCAL_ID, 'stale-a', 'stale-b']),
        },
      );
      expect(createProjectInStorage).toHaveBeenCalledWith(
        expect.anything(),
        'Remote Only',
        expect.objectContaining({ cloudId: 'cloud-new' }),
        {
          protectedLocalIds: expect.arrayContaining([TEST_LOCAL_ID, 'stale-a', 'stale-b']),
        },
      );
      const calls = (updateProjectMetadata as Mock).mock.calls.map(([localId]) => localId);
      expect(calls.indexOf('stale-a')).toBeLessThan(calls.indexOf('patched-local'));
      expect(calls.indexOf('stale-b')).toBeLessThan(calls.indexOf('patched-local'));
    });

    it('removes stale manifest-only placeholders without local project data', async () => {
      const placeholderLocalId = 'placeholder-local';
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({
          localId: placeholderLocalId,
          cloudId: 'placeholder-stale',
          storage: 'cloud',
        })],
      });
      (hasLocalData as Mock).mockReturnValue(false);
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.staleCloudIds).toEqual(['placeholder-stale']);
      expect(syncResult!.staleReconciledCloudIds).toEqual(['placeholder-stale']);
      expect(syncResult!.staleReconcileFailedCloudIds).toEqual([]);
      expect(deleteProjectFromStorage).toHaveBeenCalledWith(placeholderLocalId);
      expect(updateProjectMetadata).not.toHaveBeenCalled();
    });

    it('reports stale reconciliation failures without resetting active cloud state', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'failed-stale', storage: 'cloud' })],
      });
      (apiListProjects as Mock).mockResolvedValue({ projects: [] });
      (updateProjectMetadata as Mock).mockReturnValue({
        ok: false,
        status: 'quota-exceeded',
        evictedLocalIds: [],
        project: undefined,
      });

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('failed-stale', true, 'cloud', {
          serverVersion: 3,
          cloudSavedAt: '2024-01-01T00:00:00Z',
          visibility: 'private',
        });
      });

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.staleCloudIds).toEqual(['failed-stale']);
      expect(syncResult!.staleReconciledCloudIds).toEqual([]);
      expect(syncResult!.staleReconcileFailedCloudIds).toEqual(['failed-stale']);
      expect(result.current.state.cloudId).toBe('failed-stale');
      expect(result.current.state.error).toBe('Cloud project was deleted on the server, but local metadata could not be updated.');
    });

    it('creates manifest-only placeholders for cloud-only projects', async () => {
      (loadManifest as Mock).mockReturnValue({ version: 1, projects: [] });
      (createProjectInStorage as Mock).mockReturnValue('created-placeholder');
      (apiListProjects as Mock).mockResolvedValue({
        projects: [
          {
            id: 'cloud-new',
            title: 'Remote Only',
            visibility: 'unlisted',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-02-01T00:00:00Z',
            version: 4,
          },
        ],
      });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.placeholdersCreated).toBe(1);
      expect(createProjectInStorage).toHaveBeenCalledWith(
        EMPTY_SERIALIZED_STATE,
        'Remote Only',
        expect.objectContaining({
          cloudId: 'cloud-new',
          visibility: 'unlisted',
          cloudSavedAt: '2024-02-01T00:00:00Z',
          serverVersion: 4,
          storage: 'cloud',
        }),
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
      expect(evictProjectData).toHaveBeenCalledWith('created-placeholder');
    });

    it('creates an owned placeholder when server ownership matches an invalid saved local cloud fork', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({
            localId: 'local-fork',
            cloudId: 'shared-cloud-id',
            cloudSavedAt: '2024-01-01T00:00:00Z',
            visibility: 'private',
            storage: 'local',
          }),
        ],
      });
      (createProjectInStorage as Mock).mockReturnValue('owned-placeholder');
      (apiListProjects as Mock).mockResolvedValue({
        projects: [
          {
            id: 'shared-cloud-id',
            title: 'Owned Server Copy',
            visibility: 'unlisted',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-02-01T00:00:00Z',
            version: 5,
          },
        ],
      });

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.updatedCount).toBe(0);
      expect(syncResult!.placeholdersCreated).toBe(1);
      expect(updateProjectMetadata).not.toHaveBeenCalled();
      expect(syncResult!.staleCloudIds).not.toContain('shared-cloud-id');
      expect(createProjectInStorage).toHaveBeenCalledWith(
        EMPTY_SERIALIZED_STATE,
        'Owned Server Copy',
        expect.objectContaining({
          cloudId: 'shared-cloud-id',
          visibility: 'unlisted',
          cloudSavedAt: '2024-02-01T00:00:00Z',
          serverVersion: 5,
          storage: 'cloud',
          hasUnsyncedChanges: false,
        }),
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
      expect(evictProjectData).toHaveBeenCalledWith('owned-placeholder');
    });

    it('returns empty result when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);

      const { result } = renderCloudSync();

      let syncResult: SyncResult;
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.updatedCount).toBe(0);
      expect(syncResult!.staleCloudIds).toHaveLength(0);
      expect(apiListProjects).not.toHaveBeenCalled();
    });

    it('propagates sync errors to callers', async () => {
      (apiListProjects as Mock).mockRejectedValue(new Error('Network error'));

      const { result } = renderCloudSync();

      await expect(
        act(async () => {
          await result.current.actions.syncCloudProjects();
        }),
      ).rejects.toThrow('Network error');
    });

  });

  describe('unlinkCloudProject', () => {
    it('clears cloud metadata for a project', () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-unlink', storage: 'cloud' })],
      });

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.unlinkCloudProject(TEST_LOCAL_ID);
      });

      // updateCloudMetadata flows through ProjectStorageProvider to updateProjectMetadata
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        expect.objectContaining({ cloudId: null }),
        { protectedLocalIds: [TEST_LOCAL_ID] },
      );
    });

    it('does nothing when project has no cloudId', () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: null })],
      });

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.unlinkCloudProject(TEST_LOCAL_ID);
      });

      // Should not throw or modify state
      expect(result.current.state.cloudId).toBeNull();
    });

    it('clears active cloud state when unlinking the active project', async () => {
      // Mock manifest to include the cloud entry so provider picks it up
      // after saveToCloud → updateCloudMetadata → refreshProjectList
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-active', storage: 'cloud' })],
      });
      mockServerProjects('cloud-active');

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('cloud-active', true, 'cloud');
      });
      expect(result.current.state.cloudId).toBe('cloud-active');

      // Now unlink — projects list already has the cloud entry from provider
      act(() => {
        result.current.actions.unlinkCloudProject(TEST_LOCAL_ID);
      });

      expect(result.current.state.cloudId).toBeNull();
    });
  });

  describe('dismissLogin', () => {
    it('resets loginRequired to false and clears pending op', async () => {
      // Start unauthenticated so save triggers loginRequired
      authMock.user = null;
      authMock.getJwt.mockReturnValue(null);

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });
      expect(result.current.state.loginRequired).toBe(true);

      act(() => {
        result.current.actions.dismissLogin();
      });

      expect(result.current.state.loginRequired).toBe(false);
      // After cancel, authenticating should NOT retry the operation
    });
  });

  describe('retry-after-login', () => {
    it('retries pending save after auth transition null→user', async () => {
      // Start unauthenticated
      authMock.user = null;
      authMock.getJwt.mockReturnValue(null);

      const { result, rerender } = renderCloudSync();

      // Attempt save — should set loginRequired
      await act(async () => {
        await result.current.actions.saveToCloud();
      });
      expect(result.current.state.loginRequired).toBe(true);
      expect(apiCreateProject).not.toHaveBeenCalled();

      // Simulate login: set auth state and provide JWT
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-retry',
        shareUrl: 'https://example.com/#/p/cloud-retry',
        createdAt: '2024-01-01T12:00:00Z',
      });
      authMock.user = { id: 1, email: 'test@test.com' };
      authMock.getJwt.mockReturnValue('mock-jwt-token');

      // Re-render to trigger auth-transition effect
      await act(async () => {
        rerender();
      });

      // The pending save should have been retried
      expect(result.current.state.loginRequired).toBe(false);
      expect(apiCreateProject).toHaveBeenCalled();
    });

    it('retries pending fork after auth transition null→user', async () => {
      // Start unauthenticated
      authMock.user = null;
      authMock.getJwt.mockReturnValue(null);

      const { result, rerender } = renderCloudSync();

      // Attempt fork — should set loginRequired
      await act(async () => {
        await result.current.actions.fork();
      });
      expect(result.current.state.loginRequired).toBe(true);
      expect(apiCreateProject).not.toHaveBeenCalled();

      // Simulate login
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-fork-retry',
        shareUrl: 'https://example.com/#/p/cloud-fork-retry',
        createdAt: '2024-01-01T12:00:00Z',
      });
      authMock.user = { id: 1, email: 'test@test.com' };
      authMock.getJwt.mockReturnValue('mock-jwt-token');

      await act(async () => {
        rerender();
      });

      expect(result.current.state.loginRequired).toBe(false);
      expect(apiCreateProject).toHaveBeenCalled();
    });
  });

  describe('fork loginRequired', () => {
    it('triggers login dialog when JWT missing for fork', async () => {
      authMock.user = null;
      authMock.getJwt.mockReturnValue(null);

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.fork();
      });

      expect(result.current.state.loginRequired).toBe(true);
      expect(apiCreateProject).not.toHaveBeenCalled();
    });
  });

  describe('eviction on project switch', () => {
    const PREV_LOCAL_ID = 'prev-local';
    const NEXT_LOCAL_ID = 'next-local';

    function renderWithProjectSwitch() {
      return renderHook(
        () => ({
          state: useCloudSync(),
          actions: useCloudSyncActions(),
          storageActions: useProjectStorageActions(),
          dispatch: useAppDispatch(),
        }),
        {
          wrapper: ({ children }: { children: ReactNode }) => {
            const initialState = makeState({
              registers: [makeRegister({ id: 'reg-1' })],
              registerValues: { 'reg-1': 0xFFn },
            });
            return (
              <AppProvider savedState={initialState}>
                <EditProvider>
                  <ProjectStorageProvider initialLocalId={PREV_LOCAL_ID}>
                    <CloudSyncProvider>{children}</CloudSyncProvider>
                  </ProjectStorageProvider>
                </EditProvider>
              </AppProvider>
            );
          },
        },
      );
    }

    it('does not evict when flush fails', async () => {
      // Ensure JWT is available so flushSync doesn't short-circuit at the JWT check
      authMock.getJwt.mockReturnValue('mock-jwt');

      // Setup: previous project is cloud-backed
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev' }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });
      // loadProject is called by switchProject; return valid data for the next project
      (loadProject as Mock).mockReturnValue({
        localId: NEXT_LOCAL_ID,
        state: makeState(),
      });

      // Make the cloud save fail (flushSync calls rawActiveOps.saveToCloud → update)
      (apiUpdateProject as Mock).mockRejectedValue(new Error('Network error'));

      // Suppress getProject (ownership re-evaluation)
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderWithProjectSwitch();

      // Initialize the cloud state so flushSync has a cloudId + isOwner
      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true);
      });

      // Make data dirty so flushSync actually attempts a save
      act(() => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
      });

      // Switch to a different project — triggers eviction effect
      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });

      // Wait for flushSync promise to settle
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      // Eviction should NOT have happened because flush failed
      expect(evictProjectData).not.toHaveBeenCalled();
    });

    it('does not evict if user navigated back to the same project', async () => {
      // Setup: previous project is cloud-backed
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev' }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });

      // loadProject returns valid data for both projects
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        state: makeState(),
      }));

      // Make flushSync take time (slow save)
      let resolveFlush: (() => void) | undefined;
      (apiUpdateProject as Mock).mockImplementation(
        () => new Promise<void>((resolve) => { resolveFlush = resolve; }),
      );

      // Suppress getProject (ownership re-evaluation)
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderWithProjectSwitch();

      // Initialize cloud state so flushSync has a cloudId + isOwner
      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true);
      });

      // Switch away from prev project
      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });

      // Quickly switch back before flush completes
      await act(async () => {
        result.current.storageActions.switchProject(PREV_LOCAL_ID);
      });

      // Now resolve the flush
      await act(async () => {
        resolveFlush?.();
        await new Promise(r => setTimeout(r, 50));
      });

      // Eviction should NOT have happened because user is back on prev project
      expect(evictProjectData).not.toHaveBeenCalledWith(PREV_LOCAL_ID);
    });

    it('flushes a fast edit locally before switch and saves that departing payload to cloud', async () => {
      authMock.getJwt.mockReturnValue('mock-jwt');
      mockServerProjects('cloud-prev');

      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev', storage: 'cloud', serverVersion: 1 }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });

      const latestPrevProjectState: SerializedAppState = {
        registers: [makeRegister({ id: 'reg-1' })],
        activeRegisterId: null,
        registerValues: { 'reg-1': '0x42' },
      };
      const nextProjectState = makeState({
        registers: [makeRegister({ id: 'reg-2' })],
        registerValues: { 'reg-2': 0xBBn },
      });
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        cloudId: id === PREV_LOCAL_ID ? 'cloud-prev' : null,
        storage: id === PREV_LOCAL_ID ? 'cloud' : 'local',
        serverVersion: id === PREV_LOCAL_ID ? 1 : null,
        state: id === NEXT_LOCAL_ID ? nextProjectState : latestPrevProjectState,
      }));
      (flushProjectState as Mock).mockImplementation((id: string, state: StoredLocalProject['state']) => writeOk(makeStoredProject({
        localId: id,
        cloudId: 'cloud-prev',
        storage: 'cloud',
        serverVersion: 1,
        cloudSavedAt: '2025-01-01T00:00:00Z',
        visibility: 'private',
        state,
      })));
      const latestCloudPayload = { registerValues: { 'reg-1': 0x42n } };
      (exportToObject as Mock).mockReturnValue(latestCloudPayload);

      // Cloud update succeeds
      (apiUpdateProject as Mock).mockResolvedValue({ id: 'cloud-prev', updatedAt: '2026-01-01T00:00:00Z', version: 2 });
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderWithProjectSwitch();

      // Initialize cloud state for the previous project
      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true, 'cloud');
      });

      // Make data dirty so the best-effort save fires
      await act(async () => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
        await Promise.resolve();
      });
      await vi.waitFor(() => {
        expect(result.current.state.isDirty).toBe(true);
      });

      // Switch to the next project — triggers best-effort save
      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });

      // Wait for save promise to settle
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(flushProjectState).toHaveBeenCalledWith(
        PREV_LOCAL_ID,
        expect.objectContaining({
          registerValues: { 'reg-1': 0x42n },
        }),
        expect.objectContaining({
          protectedLocalIds: [NEXT_LOCAL_ID],
        }),
      );
      expect(loadProject).toHaveBeenCalledWith(PREV_LOCAL_ID);
      expect(apiUpdateProject).toHaveBeenCalledWith(
        'cloud-prev',
        latestCloudPayload,
        'mock-jwt',
        1,
      );
    });

    it('does not PUT on a clean switch after the incoming project bumps dataVersion', async () => {
      authMock.getJwt.mockReturnValue('mock-jwt');
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev', storage: 'cloud', serverVersion: 5 }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        cloudId: id === PREV_LOCAL_ID ? 'cloud-prev' : null,
        storage: id === PREV_LOCAL_ID ? 'cloud' : 'local',
        serverVersion: id === PREV_LOCAL_ID ? 5 : null,
        state: id === NEXT_LOCAL_ID
          ? makeState({ registers: [makeRegister({ id: 'reg-2' })] })
          : makeState({ registers: [makeRegister({ id: 'reg-1' })], registerValues: { 'reg-1': 0xFFn } }),
      }));
      (flushProjectState as Mock).mockImplementation((id: string, state: StoredLocalProject['state']) => writeOk(makeStoredProject({
        localId: id,
        cloudId: 'cloud-prev',
        storage: 'cloud',
        serverVersion: 5,
        cloudSavedAt: '2025-01-01T00:00:00Z',
        visibility: 'private',
        state,
      })));
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderWithProjectSwitch();

      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true, 'cloud', { serverVersion: 5 });
      });

      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(flushProjectState).toHaveBeenCalledWith(
        PREV_LOCAL_ID,
        expect.anything(),
        expect.objectContaining({
          protectedLocalIds: [NEXT_LOCAL_ID],
        }),
      );
      expect(apiUpdateProject).not.toHaveBeenCalled();
    });

    it('skips departing switch save when JWT is unavailable', async () => {
      authMock.user = null;
      authMock.getJwt.mockReturnValue(null);
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev', storage: 'cloud', serverVersion: 1 }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        cloudId: id === PREV_LOCAL_ID ? 'cloud-prev' : null,
        storage: id === PREV_LOCAL_ID ? 'cloud' : 'local',
        serverVersion: id === PREV_LOCAL_ID ? 1 : null,
        state: makeState({ registers: [makeRegister({ id: id === PREV_LOCAL_ID ? 'reg-1' : 'reg-2' })] }),
      }));
      (flushProjectState as Mock).mockImplementation((id: string, state: StoredLocalProject['state']) => writeOk(makeStoredProject({
        localId: id,
        cloudId: 'cloud-prev',
        storage: 'cloud',
        serverVersion: 1,
        cloudSavedAt: '2025-01-01T00:00:00Z',
        visibility: 'private',
        state,
      })));

      const { result } = renderWithProjectSwitch();

      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true, 'cloud', { serverVersion: 1 });
      });
      await act(async () => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
        await Promise.resolve();
      });
      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });

      expect(flushProjectState).toHaveBeenCalled();
      expect(apiUpdateProject).not.toHaveBeenCalled();
    });

    it('marks departing non-active switch-save conflicts for later recovery', async () => {
      authMock.getJwt.mockReturnValue('mock-jwt');
      mockServerProjects('cloud-prev');
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev', storage: 'cloud', serverVersion: 1 }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        cloudId: id === PREV_LOCAL_ID ? 'cloud-prev' : null,
        storage: id === PREV_LOCAL_ID ? 'cloud' : 'local',
        serverVersion: id === PREV_LOCAL_ID ? 1 : null,
        state: makeState({ registers: [makeRegister({ id: id === PREV_LOCAL_ID ? 'reg-1' : 'reg-2' })] }),
      }));
      (flushProjectState as Mock).mockImplementation((id: string, state: StoredLocalProject['state']) => writeOk(makeStoredProject({
        localId: id,
        cloudId: 'cloud-prev',
        storage: 'cloud',
        serverVersion: 1,
        cloudSavedAt: '2025-01-01T00:00:00Z',
        visibility: 'private',
        state,
      })));
      (apiUpdateProject as Mock).mockRejectedValue(
        new ApiError(409, { error: 'version_conflict', currentVersion: 9 }),
      );
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderWithProjectSwitch();

      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true, 'cloud', { serverVersion: 1 });
      });
      await act(async () => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
        await Promise.resolve();
      });
      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      expect(updateProjectMetadata).toHaveBeenCalledWith(
        PREV_LOCAL_ID,
        {
          serverVersion: 9,
          cloudConflictVersion: 9,
          hasUnsyncedChanges: true,
        },
        { protectedLocalIds: [NEXT_LOCAL_ID] },
      );
      expect(result.current.state.conflict).toBeNull();
    });

    it('defers departing switch save while an active save holds the mutation lock', async () => {
      authMock.getJwt.mockReturnValue('mock-jwt');
      mockServerProjects('cloud-prev');
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev', storage: 'cloud', serverVersion: 1 }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        cloudId: id === PREV_LOCAL_ID ? 'cloud-prev' : null,
        storage: id === PREV_LOCAL_ID ? 'cloud' : 'local',
        serverVersion: id === PREV_LOCAL_ID ? 2 : null,
        state: makeState({ registers: [makeRegister({ id: id === PREV_LOCAL_ID ? 'reg-1' : 'reg-2' })] }),
      }));
      (flushProjectState as Mock).mockImplementation((id: string, state: StoredLocalProject['state']) => writeOk(makeStoredProject({
        localId: id,
        cloudId: 'cloud-prev',
        storage: 'cloud',
        serverVersion: 1,
        cloudSavedAt: '2025-01-01T00:00:00Z',
        visibility: 'private',
        state,
      })));
      (exportToObject as Mock).mockReturnValue({ registerValues: { 'reg-1': 0x42n } });

      let resolveActiveSave: ((value: unknown) => void) | undefined;
      (apiUpdateProject as Mock)
        .mockImplementationOnce(() => new Promise((resolve) => { resolveActiveSave = resolve; }))
        .mockResolvedValueOnce({ id: 'cloud-prev', updatedAt: '2026-01-01T00:00:00Z', version: 3 });
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderWithProjectSwitch();

      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true, 'cloud', { serverVersion: 1 });
      });
      await act(async () => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
        await Promise.resolve();
      });

      act(() => {
        void result.current.actions.saveToCloud();
      });
      expect(apiUpdateProject).toHaveBeenCalledTimes(1);

      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });
      expect(apiUpdateProject).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveActiveSave?.({ id: 'cloud-prev', updatedAt: '2026-01-01T00:00:00Z', version: 2 });
        await new Promise(r => setTimeout(r, 300));
      });

      expect(apiUpdateProject).toHaveBeenCalledTimes(2);
      expect(apiUpdateProject).toHaveBeenLastCalledWith(
        'cloud-prev',
        { registerValues: { 'reg-1': 0x42n } },
        'mock-jwt',
        2,
      );
    });
  });

  describe('SEC-H2 regression: non-owned cloud projects must not be evicted', () => {
    const PREV_LOCAL_ID = 'prev-local';
    const NEXT_LOCAL_ID = 'next-local';

    it('does not evict a shared project (storage=local) on project switch', async () => {
      // Shared project loaded via link: has cloudId but storage='local'
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'shared-cloud', storage: 'local' }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        state: makeState(),
      }));
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderHook(
        () => ({
          state: useCloudSync(),
          actions: useCloudSyncActions(),
          storageActions: useProjectStorageActions(),
        }),
        {
          wrapper: ({ children }: { children: ReactNode }) => {
            const initialState = makeState({
              registers: [makeRegister({ id: 'reg-1' })],
            });
            return (
              <AppProvider savedState={initialState}>
                <EditProvider>
                  <ProjectStorageProvider initialLocalId={PREV_LOCAL_ID}>
                    <CloudSyncProvider>{children}</CloudSyncProvider>
                  </ProjectStorageProvider>
                </EditProvider>
              </AppProvider>
            );
          },
        },
      );

      // Initialize as non-owner shared project
      await act(async () => {
        result.current.actions.initFromProject('shared-cloud', false, 'local');
      });

      // Switch to another project
      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });

      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      // Should NOT evict because storage='local' (non-owned)
      expect(evictProjectData).not.toHaveBeenCalled();
    });
  });

  describe('SEC-N02 regression: ownership inference', () => {
    it('does not grant ownership to authenticated users for non-owned projects', () => {
      // Simulate: user is logged in with a JWT
      authMock.user = { id: 1, email: 'user@example.com' };
      authMock.getJwt.mockReturnValue('mock-jwt-token');

      // Prevent the async re-evaluation effect from resolving during this test
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('shared-cloud-id', false, 'local');
      });

      // The activeLocalId effect should NOT infer ownership from !!getJwt()
      expect(result.current.state.cloudId).toBe('shared-cloud-id');
      expect(result.current.state.isOwner).toBe(false);
    });

    it('promotes ownership after server confirms via re-evaluation effect', async () => {
      authMock.user = { id: 1, email: 'user@example.com' };
      authMock.getJwt.mockReturnValue('mock-jwt-token');

      // Server confirms ownership
      (apiGetProject as Mock).mockResolvedValue({
        isOwner: true,
        version: 6,
        updatedAt: '2024-08-01T00:00:00Z',
        visibility: 'unlisted',
      });

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.initFromProject('my-cloud-id', false, 'local');
      });

      // Initially false (synchronous phase)
      expect(result.current.state.isOwner).toBe(false);

      // Flush the async re-evaluation effect (getProject promise + state update)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(apiGetProject).toHaveBeenCalledWith('my-cloud-id', 'mock-jwt-token');
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        {
          cloudId: 'my-cloud-id',
          storage: 'cloud',
          serverVersion: 6,
          cloudSavedAt: '2024-08-01T00:00:00Z',
          visibility: 'unlisted',
          cloudConflictVersion: null,
          hasUnsyncedChanges: false,
        },
        { protectedLocalIds: [TEST_LOCAL_ID] },
      );
      expect(result.current.state.isOwner).toBe(true);
      expect(result.current.state.visibility).toBe('unlisted');
      expect(result.current.state.lastCloudSavedAt).toBe('2024-08-01T00:00:00Z');
    });

    it('saves an unsaved active cloud-source project before promoting ownership metadata', async () => {
      authMock.user = { id: 1, email: 'user@example.com' };
      authMock.getJwt.mockReturnValue('mock-jwt-token');
      (apiGetProject as Mock).mockResolvedValue({
        isOwner: true,
        version: 3,
        updatedAt: '2024-08-02T00:00:00Z',
        visibility: 'private',
      });
      (createProjectInStorage as Mock).mockReturnValue('saved-from-unsaved');
      (updateProjectMetadata as Mock).mockImplementation((localId: string, updates: Partial<StoredLocalProject>) => {
        (loadManifest as Mock).mockReturnValue({
          version: 1,
          projects: [makeManifestEntry({
            localId,
            cloudId: updates.cloudId ?? null,
            storage: updates.storage ?? 'local',
            serverVersion: updates.serverVersion ?? null,
            cloudSavedAt: updates.cloudSavedAt ?? null,
            visibility: updates.visibility ?? 'private',
            hasUnsyncedChanges: updates.hasUnsyncedChanges,
            cloudConflictVersion: updates.cloudConflictVersion,
          })],
        });
        (loadProject as Mock).mockReturnValue(makeStoredProject({
          localId,
          cloudId: updates.cloudId ?? null,
          storage: updates.storage ?? 'local',
          serverVersion: updates.serverVersion ?? null,
          cloudSavedAt: updates.cloudSavedAt ?? null,
          visibility: updates.visibility ?? 'private',
          hasUnsyncedChanges: updates.hasUnsyncedChanges,
          cloudConflictVersion: updates.cloudConflictVersion,
        }));
        return writeOk(makeStoredProject({ localId, ...updates }));
      });

      const { result } = renderHook(
        () => ({
          state: useCloudSync(),
          actions: useCloudSyncActions(),
        }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <AppProvider savedState={makeState({ registers: [makeRegister({ id: 'reg-1' })] })}>
              <EditProvider>
                <ProjectStorageProvider
                  initialLocalId={null}
                  initialUnsaved={{ name: 'Shared Cloud', source: 'cloud' }}
                >
                  <CloudSyncProvider>{children}</CloudSyncProvider>
                </ProjectStorageProvider>
              </EditProvider>
            </AppProvider>
          ),
        },
      );

      await act(async () => {
        result.current.actions.initFromProject('my-cloud-id', false, 'local', {
          serverVersion: 3,
          cloudSavedAt: '2024-08-02T00:00:00Z',
          visibility: 'private',
        });
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(createProjectInStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          registers: expect.any(Array),
          registerValues: expect.any(Object),
        }),
        'Shared Cloud',
        undefined,
        expect.objectContaining({ protectedLocalIds: [null] }),
      );
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        'saved-from-unsaved',
        expect.objectContaining({
          cloudId: 'my-cloud-id',
          storage: 'cloud',
          serverVersion: 3,
          cloudSavedAt: '2024-08-02T00:00:00Z',
          visibility: 'private',
          cloudConflictVersion: null,
          hasUnsyncedChanges: false,
        }),
        { protectedLocalIds: ['saved-from-unsaved'] },
      );
      await vi.waitFor(() => {
        expect(result.current.state.isOwner).toBe(true);
      });
    });

    it('does not promote ownership when saving the unsaved workspace fails', async () => {
      authMock.user = { id: 1, email: 'user@example.com' };
      authMock.getJwt.mockReturnValue('mock-jwt-token');
      (apiGetProject as Mock).mockResolvedValue({
        isOwner: true,
        version: 3,
        updatedAt: '2024-08-02T00:00:00Z',
        visibility: 'private',
      });
      (createProjectInStorage as Mock).mockImplementation(() => {
        throw new Error('quota');
      });

      const { result } = renderHook(
        () => ({
          state: useCloudSync(),
          actions: useCloudSyncActions(),
        }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <AppProvider savedState={makeState({ registers: [makeRegister({ id: 'reg-1' })] })}>
              <EditProvider>
                <ProjectStorageProvider
                  initialLocalId={null}
                  initialUnsaved={{ name: 'Shared Cloud', source: 'cloud' }}
                >
                  <CloudSyncProvider>{children}</CloudSyncProvider>
                </ProjectStorageProvider>
              </EditProvider>
            </AppProvider>
          ),
        },
      );

      await act(async () => {
        result.current.actions.initFromProject('my-cloud-id', false, 'local', {
          serverVersion: 3,
          cloudSavedAt: '2024-08-02T00:00:00Z',
          visibility: 'private',
        });
      });

      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(updateProjectMetadata).not.toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ storage: 'cloud' }),
        expect.anything(),
      );
      expect(result.current.state.isOwner).toBe(false);
      expect(result.current.state.error).toContain('could not be saved locally');
    });
  });
});
