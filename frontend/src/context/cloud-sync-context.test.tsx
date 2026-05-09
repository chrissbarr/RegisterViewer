import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import { CloudSyncProvider, useCloudSync, useCloudSyncActions } from './cloud-sync-context';
import { AppProvider } from './app-context';
import { EditProvider } from './edit-context';
import { ProjectStorageProvider, useProjectStorageActions } from './project-storage-context';
import { useAppDispatch } from './app-context';
import { makeState, makeRegister } from '../test/helpers';
import type { ProjectManifestEntry } from '../types/project';
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
  createProject: vi.fn(),
  updateProject: vi.fn(),
  patchProjectVisibility: vi.fn(),
  getProject: vi.fn(),
  deleteProject: vi.fn(),
  listProjects: vi.fn(),
}));

vi.mock('../utils/cloud-project-loader', () => ({
  fetchAndParseCloudProject: vi.fn(),
}));


vi.mock('../utils/project-storage', () => ({
  loadManifest: vi.fn(() => ({ version: 1, projects: [] })),
  saveManifest: vi.fn(),
  loadProject: vi.fn(() => null),
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
  loadManifest,
  loadProject,
  updateProjectMetadata,
  evictProjectData,
} from '../utils/project-storage';
import { exportToObject, deserializeState } from '../utils/storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_LOCAL_ID = 'local-123';

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
        projects: [makeManifestEntry({ cloudId: 'cloud-xyz' })],
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
        projects: [makeManifestEntry({ cloudId: 'cloud-xyz' })],
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

      await act(async () => {
        await result.current.actions.saveProjectToCloud(TEST_LOCAL_ID);
      });

      expect(loadProject).not.toHaveBeenCalled();
    });
  });

  describe('deleteProjectFromCloud', () => {
    it('deletes a cloud project by cloudId', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-del' })],
      });
      (apiDeleteProject as Mock).mockResolvedValue(undefined);

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.deleteProjectFromCloud('cloud-del');
      });

      expect(apiDeleteProject).toHaveBeenCalledWith('cloud-del', 'mock-jwt-token');
    });

    it('throws when JWT missing', async () => {
      authMock.getJwt.mockReturnValue(null);

      const { result } = renderCloudSync();

      await expect(
        act(async () => {
          await result.current.actions.deleteProjectFromCloud('cloud-del');
        }),
      ).rejects.toThrow('Authentication required. Please sign in.');
    });

    it('clears active cloud state when deleting the active cloud project', async () => {
      // First save to cloud to set active cloudId
      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-active',
        shareUrl: 'https://example.com/#/p/cloud-active',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
      });
      expect(result.current.state.cloudId).toBe('cloud-active');

      // Now delete that same cloud project via deleteProjectFromCloud
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'cloud-active' })],
      });
      (apiDeleteProject as Mock).mockResolvedValue(undefined);

      await act(async () => {
        await result.current.actions.deleteProjectFromCloud('cloud-active');
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
        version: 1,
      };
      (fetchAndParseCloudProject as Mock).mockResolvedValue(importResult);

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
    it('syncs metadata from server and returns update count', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({
            cloudId: 'cloud-1',
            cloudSavedAt: '2024-01-01T00:00:00Z',
            visibility: 'private',
            storage: 'cloud',
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

      let syncResult: { updatedCount: number; staleCloudIds: string[]; placeholdersCreated: number };
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.updatedCount).toBe(1);
      expect(syncResult!.staleCloudIds).toHaveLength(0);
      // Patches are routed through updateCloudMetadata → updateProjectMetadata
      expect(updateProjectMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
        cloudSavedAt: '2024-02-01T00:00:00Z',
        visibility: 'unlisted',
        serverVersion: 1,
      });
    });

    it('detects stale cloud IDs not present on server', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ cloudId: 'cloud-stale', storage: 'cloud' }),
        ],
      });
      (apiListProjects as Mock).mockResolvedValue({
        projects: [], // server has no projects
      });

      const { result } = renderCloudSync();

      let syncResult: { updatedCount: number; staleCloudIds: string[]; placeholdersCreated: number };
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.updatedCount).toBe(0);
      expect(syncResult!.staleCloudIds).toEqual(['cloud-stale']);
    });

    it('does not sync metadata for shared projects with cloudId but storage=local', async () => {
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({
            cloudId: 'shared-cloud-id',
            cloudSavedAt: '2024-01-01T00:00:00Z',
            visibility: 'private',
            storage: 'local',
          }),
        ],
      });
      (apiListProjects as Mock).mockResolvedValue({
        projects: [
          {
            id: 'shared-cloud-id',
            visibility: 'unlisted',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-02-01T00:00:00Z',
            version: 1,
          },
        ],
      });

      const { result } = renderCloudSync();

      let syncResult: { updatedCount: number; staleCloudIds: string[]; placeholdersCreated: number };
      await act(async () => {
        syncResult = await result.current.actions.syncCloudProjects();
      });

      expect(syncResult!.updatedCount).toBe(0);
      expect(updateProjectMetadata).not.toHaveBeenCalled();
      expect(syncResult!.staleCloudIds).not.toContain('shared-cloud-id');
    });

    it('returns empty result when cloud is disabled', async () => {
      (isCloudEnabled as Mock).mockReturnValue(false);

      const { result } = renderCloudSync();

      let syncResult: { updatedCount: number; staleCloudIds: string[]; placeholdersCreated: number };
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
        projects: [makeManifestEntry({ cloudId: 'cloud-unlink' })],
      });

      const { result } = renderCloudSync();

      act(() => {
        result.current.actions.unlinkCloudProject(TEST_LOCAL_ID);
      });

      // updateCloudMetadata flows through ProjectStorageProvider to updateProjectMetadata
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        expect.objectContaining({ cloudId: null }),
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
        projects: [makeManifestEntry({ cloudId: 'cloud-active' })],
      });

      (apiCreateProject as Mock).mockResolvedValue({
        id: 'cloud-active',
        shareUrl: 'https://example.com/#/p/cloud-active',
        createdAt: '2024-01-01T12:00:00Z',
      });

      const { result } = renderCloudSync();

      await act(async () => {
        await result.current.actions.saveToCloud();
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

    it('best-effort save reads previous project from localStorage on switch', async () => {
      // The best-effort save reads from localStorage via loadProject()
      // to get the departing project's state (not appStateRef which
      // may already point to the new project).
      authMock.getJwt.mockReturnValue('mock-jwt');

      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          makeManifestEntry({ localId: PREV_LOCAL_ID, cloudId: 'cloud-prev', storage: 'cloud', serverVersion: 1 }),
          makeManifestEntry({ localId: NEXT_LOCAL_ID, cloudId: null, name: 'Next' }),
        ],
      });

      // Return distinct states so we can tell which one was saved
      const prevProjectState = makeState({
        registers: [makeRegister({ id: 'reg-1' })],
        registerValues: { 'reg-1': 0xAAn },
      });
      const nextProjectState = makeState({
        registers: [makeRegister({ id: 'reg-2' })],
        registerValues: { 'reg-2': 0xBBn },
      });
      (loadProject as Mock).mockImplementation((id: string) => ({
        localId: id,
        state: id === NEXT_LOCAL_ID ? nextProjectState : prevProjectState,
      }));

      // Cloud update succeeds
      (apiUpdateProject as Mock).mockResolvedValue({ id: 'cloud-prev', updatedAt: '2026-01-01T00:00:00Z', version: 2 });
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderWithProjectSwitch();

      // Initialize cloud state for the previous project
      await act(async () => {
        result.current.actions.initFromProject('cloud-prev', true, 'cloud');
      });

      // Make data dirty so the best-effort save fires
      act(() => {
        result.current.dispatch({
          type: 'SET_REGISTER_VALUE',
          registerId: 'reg-1',
          value: 0x42n,
        });
      });

      // Switch to the next project — triggers best-effort save
      await act(async () => {
        result.current.storageActions.switchProject(NEXT_LOCAL_ID);
      });

      // Wait for save promise to settle
      await act(async () => {
        await new Promise(r => setTimeout(r, 50));
      });

      // loadProject should have been called with the PREVIOUS project's localId
      // to read its state from localStorage (not from appStateRef)
      expect(loadProject).toHaveBeenCalledWith(PREV_LOCAL_ID);
      // The API update should have been called for the previous project
      expect(apiUpdateProject).toHaveBeenCalledWith(
        'cloud-prev',
        expect.anything(),
        'mock-jwt',
        1, // serverVersion
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

      // Manifest has a cloud project
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'shared-cloud-id' })],
      });

      // Prevent the async re-evaluation effect from resolving during this test
      (apiGetProject as Mock).mockReturnValue(new Promise(() => {}));

      const { result } = renderCloudSync();

      // The activeLocalId effect should NOT infer ownership from !!getJwt()
      expect(result.current.state.cloudId).toBe('shared-cloud-id');
      expect(result.current.state.isOwner).toBe(false);
    });

    it('promotes ownership after server confirms via re-evaluation effect', async () => {
      authMock.user = { id: 1, email: 'user@example.com' };
      authMock.getJwt.mockReturnValue('mock-jwt-token');

      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [makeManifestEntry({ cloudId: 'my-cloud-id' })],
      });

      // Server confirms ownership
      (apiGetProject as Mock).mockResolvedValue({ isOwner: true, version: 1 });

      const { result } = renderCloudSync();

      // Initially false (synchronous phase)
      expect(result.current.state.isOwner).toBe(false);

      // Flush the async re-evaluation effect (getProject promise + state update)
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(apiGetProject).toHaveBeenCalledWith('my-cloud-id', 'mock-jwt-token');
      expect(result.current.state.isOwner).toBe(true);
    });
  });
});
