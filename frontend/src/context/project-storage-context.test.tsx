import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import { ProjectStorageProvider, useProjectStorage, useProjectStorageActions } from './project-storage-context';
import { AppProvider, useAppState, useAppDispatch } from './app-context';
import { EditProvider } from './edit-context';
import { makeState, makeRegister } from '../test/helpers';
import type { ProjectManifestEntry, StoredLocalProject } from '../types/project';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/project-storage', () => ({
  loadManifest: vi.fn(() => ({ version: 1, projects: [] })),
  saveManifest: vi.fn(),
  loadProject: vi.fn(() => null),
  saveProject: vi.fn(),
  flushProjectState: vi.fn(),
  createProject: vi.fn(() => 'new-local-id'),
  deleteProject: vi.fn(),
  updateProjectMetadata: vi.fn(),
  toProjectListEntry: vi.fn((e: ProjectManifestEntry) => ({
    localId: e.localId,
    name: e.name,
    cloudId: e.cloudId ?? null,
    visibility: e.visibility ?? 'private',
    createdAt: e.createdAt ?? '2024-01-01T00:00:00Z',
    localSavedAt: e.localSavedAt ?? '2024-01-01T00:00:00Z',
    cloudSavedAt: e.cloudSavedAt ?? null,
    storage: e.storage ?? 'local',
  })),
  getMostRecentProjectId: vi.fn(() => null),
  ACTIVE_PROJECT_SESSION_KEY: 'register-viewer-active-project',
  UNSAVED_SESSION_SENTINEL: '__unsaved__',
  clearUnsavedProject: vi.fn(),
}));

vi.mock('../utils/storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/storage')>();
  return {
    deserializeState: vi.fn((data: unknown) => data),
    serializeState: vi.fn((state: unknown) => state),
    EMPTY_SERIALIZED_STATE: actual.EMPTY_SERIALIZED_STATE,
  };
});

import {
  loadManifest,
  loadProject,
  saveProject,
  flushProjectState,
  createProject as createProjectInStorage,
  deleteProject as deleteProjectFromStorage,
  updateProjectMetadata,
  toProjectListEntry,
  getMostRecentProjectId,
} from '../utils/project-storage';
import { deserializeState } from '../utils/storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_LOCAL_ID = 'local-abc';

function makeManifestEntry(overrides: Partial<ProjectManifestEntry> = {}): ProjectManifestEntry {
  return {
    localId: TEST_LOCAL_ID,
    cloudId: null,
    name: 'Test Project',
    visibility: 'private',
    createdAt: '2024-01-01T00:00:00Z',
    localSavedAt: '2024-01-01T00:00:00Z',
    cloudSavedAt: null,
    storage: 'local',
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
    storage: 'local',
    state: {
      registers: [],
      activeRegisterId: null,
      registerValues: {},
      mapTableWidth: 32,
      mapShowGaps: true,
      mapSortDescending: false,
      addressUnitBits: 8,
    },
    ...overrides,
  };
}

function wrapper(initialLocalId: string | null = TEST_LOCAL_ID) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const initialState = makeState({
      registers: [makeRegister({ id: 'reg-1' })],
      registerValues: { 'reg-1': 0xFFn },
    });
    return (
      <AppProvider savedState={initialState}>
        <EditProvider>
          <ProjectStorageProvider initialLocalId={initialLocalId}>
            {children}
          </ProjectStorageProvider>
        </EditProvider>
      </AppProvider>
    );
  };
}

function renderProjectStorage(initialLocalId: string | null = TEST_LOCAL_ID) {
  return renderHook(
    () => ({
      state: useProjectStorage(),
      actions: useProjectStorageActions(),
    }),
    { wrapper: wrapper(initialLocalId) },
  );
}

function renderWithDispatch(initialLocalId: string | null = TEST_LOCAL_ID) {
  return renderHook(
    () => ({
      state: useProjectStorage(),
      actions: useProjectStorageActions(),
      dispatch: useAppDispatch(),
      appState: useAppState(),
    }),
    { wrapper: wrapper(initialLocalId) },
  );
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  (saveProject as Mock).mockReturnValue({ ok: true, status: 'ok', evictedLocalIds: [] });
  (updateProjectMetadata as Mock).mockReturnValue({ ok: true, status: 'ok', evictedLocalIds: [] });

  // Default: manifest with one project (toProjectListEntry impl lives in vi.mock factory)
  const entry = makeManifestEntry();
  (loadManifest as Mock).mockReturnValue({ version: 1, projects: [entry] });
  (flushProjectState as Mock).mockReturnValue({
    ok: true,
    status: 'ok',
    evictedLocalIds: [],
    project: makeStoredProject(),
  });
});

// ── Tests ────────────────────────────────────────────────────────────

describe('ProjectStorageProvider', () => {
  describe('initialization', () => {
    it('uses initialLocalId as active project', () => {
      const { result } = renderProjectStorage(TEST_LOCAL_ID);
      expect(result.current.state.activeLocalId).toBe(TEST_LOCAL_ID);
    });

    it('falls back to sessionStorage when no initialLocalId', () => {
      sessionStorage.setItem('register-viewer-active-project', 'session-id');
      const { result } = renderProjectStorage(null);
      expect(result.current.state.activeLocalId).toBe('session-id');
    });

    it('loads project list from manifest on mount', () => {
      const { result } = renderProjectStorage();
      expect(loadManifest).toHaveBeenCalled();
      expect(result.current.state.projects).toHaveLength(1);
      expect(result.current.state.projects[0].localId).toBe(TEST_LOCAL_ID);
    });

    it('handles empty manifest gracefully', () => {
      (loadManifest as Mock).mockReturnValue({ version: 1, projects: [] });
      const { result } = renderProjectStorage(null);
      expect(result.current.state.projects).toHaveLength(0);
      expect(result.current.state.activeLocalId).toBeNull();
    });
  });

  describe('hooks outside provider', () => {
    it('useProjectStorage throws without provider', () => {
      expect(() => {
        renderHook(() => useProjectStorage());
      }).toThrow('useProjectStorage must be used within ProjectStorageProvider');
    });

    it('useProjectStorageActions throws without provider', () => {
      expect(() => {
        renderHook(() => useProjectStorageActions());
      }).toThrow('useProjectStorageActions must be used within ProjectStorageProvider');
    });
  });

  describe('createNewProject', () => {
    it('creates a project with empty state and returns localId', () => {
      (createProjectInStorage as Mock).mockReturnValue('brand-new-id');
      const { result } = renderProjectStorage();

      let newId: string | null = null;
      act(() => {
        newId = result.current.actions.createNewProject('My Project');
      });

      expect(newId!).toBe('brand-new-id');
      expect(createProjectInStorage).toHaveBeenCalledWith(
        expect.objectContaining({
          registers: [],
          activeRegisterId: null,
          registerValues: {},
        }),
        'My Project',
        undefined,
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
    });

    it('sets created project as active', () => {
      (createProjectInStorage as Mock).mockReturnValue('brand-new-id');
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.createNewProject();
      });

      expect(result.current.state.activeLocalId).toBe('brand-new-id');
    });

    it('persists active project to sessionStorage', () => {
      (createProjectInStorage as Mock).mockReturnValue('brand-new-id');
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.createNewProject();
      });

      expect(sessionStorage.getItem('register-viewer-active-project')).toBe('brand-new-id');
    });

    it('refreshes project list after creation', () => {
      (createProjectInStorage as Mock).mockReturnValue('brand-new-id');
      const { result } = renderProjectStorage();

      // loadManifest is called during init, clear to track refresh call
      (loadManifest as Mock).mockClear();

      act(() => {
        result.current.actions.createNewProject();
      });

      expect(loadManifest).toHaveBeenCalled();
    });

    it('does not activate a new project when persistence fails', () => {
      (createProjectInStorage as Mock).mockImplementation(() => {
        throw new Error('quota');
      });
      const { result } = renderProjectStorage();

      let newId: string | null = null;
      act(() => {
        newId = result.current.actions.createNewProject('My Project');
      });

      expect(newId!).toBeNull();
      expect(result.current.state.activeLocalId).toBe(TEST_LOCAL_ID);
    });

    it('creates a replacement project when the active project was already removed from the manifest', () => {
      (loadManifest as Mock).mockReturnValue({ version: 1, projects: [] });
      (flushProjectState as Mock).mockReturnValue({
        ok: false,
        status: 'missing',
        evictedLocalIds: [],
      });
      (createProjectInStorage as Mock).mockReturnValue('replacement-id');
      const { result } = renderProjectStorage();

      let newId: string | null = null;
      act(() => {
        newId = result.current.actions.createNewProject('Replacement');
      });

      expect(newId).toBe('replacement-id');
      expect(createProjectInStorage).toHaveBeenCalled();
      expect(result.current.state.activeLocalId).toBe('replacement-id');
    });
  });

  describe('switchProject', () => {
    it('loads project state and dispatches LOAD_STATE', () => {
      const storedProject = makeStoredProject({
        localId: 'other-project',
        state: {
          registers: [{ id: 'r1', name: 'REG_A', width: 16, fields: [] }],
          activeRegisterId: 'r1',
          registerValues: { r1: '0xFF' },
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (loadProject as Mock).mockReturnValue(storedProject);
      (deserializeState as Mock).mockReturnValue(
        makeState({ registers: [makeRegister({ id: 'r1', name: 'REG_A', width: 16 })] }),
      );

      const { result } = renderWithDispatch();

      act(() => {
        result.current.actions.switchProject('other-project');
      });

      expect(loadProject).toHaveBeenCalledWith('other-project');
      expect(deserializeState).toHaveBeenCalledWith(storedProject.state);
      expect(result.current.state.activeLocalId).toBe('other-project');
    });

    it('does nothing if project not found in storage', () => {
      (loadProject as Mock).mockReturnValue(null);
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.switchProject('nonexistent');
      });

      // Active ID should remain unchanged
      expect(result.current.state.activeLocalId).toBe(TEST_LOCAL_ID);
      expect(deserializeState).not.toHaveBeenCalled();
    });

    it('persists new active project to sessionStorage', () => {
      (loadProject as Mock).mockReturnValue(makeStoredProject({ localId: 'other-project' }));
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.switchProject('other-project');
      });

      expect(sessionStorage.getItem('register-viewer-active-project')).toBe('other-project');
    });

    it('flushes departing saved project before loading the next project', () => {
      const otherProject = makeStoredProject({ localId: 'other-project' });
      const flushedProject = makeStoredProject({
        localId: TEST_LOCAL_ID,
        cloudId: 'cloud-prev',
        storage: 'cloud',
        serverVersion: 7,
      });
      (loadProject as Mock).mockReturnValueOnce(otherProject);
      (flushProjectState as Mock).mockReturnValue({
        ok: true,
        status: 'ok',
        evictedLocalIds: [],
        project: flushedProject,
      });

      const { result } = renderWithDispatch();

      act(() => {
        result.current.actions.switchProject('other-project');
      });

      expect(flushProjectState).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        expect.objectContaining({
          registers: expect.any(Array),
          registerValues: expect.any(Object),
        }),
        { protectedLocalIds: ['other-project'] },
      );
    });

    it('does not create a departure snapshot when departing flush fails', () => {
      const otherProject = makeStoredProject({ localId: 'other-project' });
      (loadProject as Mock).mockReturnValueOnce(otherProject);
      (flushProjectState as Mock).mockReturnValue({
        ok: false,
        status: 'quota-exceeded',
        evictedLocalIds: [],
      });

      const { result } = renderWithDispatch();

      act(() => {
        result.current.actions.registerDepartureSnapshotter(() => ({ wasDirty: true, serverVersion: 8 }));
        result.current.actions.switchProject('other-project');
      });

      expect(result.current.state.lastDeparture).toBeNull();
      expect(result.current.state.activeLocalId).toBe(TEST_LOCAL_ID);
      expect(deserializeState).not.toHaveBeenCalled();
    });

    it('does not replace the workspace when departing flush fails', () => {
      const otherProject = makeStoredProject({ localId: 'other-project' });
      (loadProject as Mock).mockReturnValueOnce(otherProject);
      (flushProjectState as Mock).mockReturnValue({
        ok: false,
        status: 'quota-exceeded',
        evictedLocalIds: [],
      });

      const { result } = renderWithDispatch();

      act(() => {
        const switched = result.current.actions.switchProject('other-project');
        expect(switched).toBe(false);
      });

      expect(result.current.state.activeLocalId).toBe(TEST_LOCAL_ID);
      expect(deserializeState).not.toHaveBeenCalled();
    });
  });

  describe('deleteLocalProject', () => {
    it('deletes the project from storage', () => {
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.deleteLocalProject('some-project');
      });

      expect(deleteProjectFromStorage).toHaveBeenCalledWith('some-project');
    });

    it('auto-switches to most recent project when active project is deleted', () => {
      (getMostRecentProjectId as Mock).mockReturnValue('fallback-id');
      const { result } = renderProjectStorage(TEST_LOCAL_ID);

      act(() => {
        result.current.actions.deleteLocalProject(TEST_LOCAL_ID);
      });

      expect(getMostRecentProjectId).toHaveBeenCalled();
      expect(result.current.state.activeLocalId).toBe('fallback-id');
    });

    it('sets activeLocalId to null when no remaining projects', () => {
      (getMostRecentProjectId as Mock).mockReturnValue(null);
      const { result } = renderProjectStorage(TEST_LOCAL_ID);

      act(() => {
        result.current.actions.deleteLocalProject(TEST_LOCAL_ID);
      });

      expect(result.current.state.activeLocalId).toBeNull();
    });

    it('does not change active project when deleting a non-active project', () => {
      const { result } = renderProjectStorage(TEST_LOCAL_ID);

      act(() => {
        result.current.actions.deleteLocalProject('other-project');
      });

      expect(result.current.state.activeLocalId).toBe(TEST_LOCAL_ID);
      expect(getMostRecentProjectId).not.toHaveBeenCalled();
    });

    it('refreshes project list after deletion', () => {
      const { result } = renderProjectStorage();
      (loadManifest as Mock).mockClear();

      act(() => {
        result.current.actions.deleteLocalProject('some-project');
      });

      expect(loadManifest).toHaveBeenCalled();
    });
  });

  describe('renameProject', () => {
    const storedProject: StoredLocalProject = {
      localId: TEST_LOCAL_ID,
      cloudId: null,
      name: 'Old Name',
      visibility: 'private',
      createdAt: '2024-01-01T00:00:00Z',
      localSavedAt: '2024-01-01T00:00:00Z',
      cloudSavedAt: null,
      storage: 'local',
      state: { registers: [], activeRegisterId: null, registerValues: {} },
    };

    it('saves both manifest name and state.project.title', () => {
      (loadProject as Mock).mockReturnValueOnce(storedProject);
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.renameProject(TEST_LOCAL_ID, 'New Name');
      });

      expect(saveProject).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'New Name',
          state: expect.objectContaining({
            project: expect.objectContaining({ title: 'New Name' }),
          }),
        }),
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
    });

    it('dispatches SET_PROJECT_METADATA when renaming active project', () => {
      (loadProject as Mock).mockReturnValueOnce(storedProject);
      const { result } = renderWithDispatch();

      act(() => {
        result.current.actions.renameProject(TEST_LOCAL_ID, 'New Name');
      });

      // AppState.project.title should be updated via dispatch
      expect(result.current.appState.project?.title).toBe('New Name');
    });

    it('does not dispatch when renaming a non-active project', () => {
      (loadProject as Mock).mockReturnValueOnce(storedProject);
      const { result } = renderWithDispatch();
      const initialProject = result.current.appState.project;

      act(() => {
        result.current.actions.renameProject('other-project', 'New Name');
      });

      expect(result.current.appState.project).toEqual(initialProject);
    });

    it('refreshes project list after rename', () => {
      (loadProject as Mock).mockReturnValueOnce(storedProject);
      const { result } = renderProjectStorage();
      (loadManifest as Mock).mockClear();

      act(() => {
        result.current.actions.renameProject(TEST_LOCAL_ID, 'New Name');
      });

      expect(loadManifest).toHaveBeenCalled();
    });
  });

  describe('updateCloudMetadata', () => {
    it('updates cloudId in manifest and project metadata', () => {
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.updateCloudMetadata(TEST_LOCAL_ID, {
          cloudId: 'cloud-123',
          cloudSavedAt: '2024-06-01T00:00:00Z',
        });
      });

      // updateProjectMetadata handles both project record and manifest update
      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        {
          cloudId: 'cloud-123',
          cloudSavedAt: '2024-06-01T00:00:00Z',
        },
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
    });

    it('updates visibility via updateProjectMetadata', () => {
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.updateCloudMetadata(TEST_LOCAL_ID, {
          visibility: 'unlisted',
        });
      });

      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        { visibility: 'unlisted' },
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
    });

    it('handles clearing cloud metadata (null values)', () => {
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.updateCloudMetadata(TEST_LOCAL_ID, {
          cloudId: null,
          cloudSavedAt: null,
        });
      });

      expect(updateProjectMetadata).toHaveBeenCalledWith(
        TEST_LOCAL_ID,
        {
          cloudId: null,
          cloudSavedAt: null,
        },
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
    });

    it('delegates to updateProjectMetadata even if project not in manifest', () => {
      const { result } = renderProjectStorage();

      act(() => {
        result.current.actions.updateCloudMetadata('nonexistent', { cloudId: 'abc' });
      });

      expect(updateProjectMetadata).toHaveBeenCalledWith(
        'nonexistent',
        { cloudId: 'abc' },
        expect.objectContaining({ protectedLocalIds: [TEST_LOCAL_ID] }),
      );
    });

    it('refreshes project list after update', () => {
      const entry = makeManifestEntry();
      (loadManifest as Mock).mockReturnValue({ version: 1, projects: [entry] });

      const { result } = renderProjectStorage();
      // Clear to track only the refresh call
      (toProjectListEntry as Mock).mockClear();

      act(() => {
        result.current.actions.updateCloudMetadata(TEST_LOCAL_ID, { visibility: 'unlisted' });
      });

      expect(toProjectListEntry).toHaveBeenCalled();
    });

    it('returns a failed write result and skips refresh when metadata persistence fails', () => {
      (updateProjectMetadata as Mock).mockReturnValue({
        ok: false,
        status: 'quota-exceeded',
        evictedLocalIds: [],
      });
      const { result } = renderProjectStorage();
      (toProjectListEntry as Mock).mockClear();

      let writeResult: unknown;
      act(() => {
        writeResult = result.current.actions.updateCloudMetadata(TEST_LOCAL_ID, { visibility: 'unlisted' });
      });

      expect(writeResult).toMatchObject({ ok: false, status: 'quota-exceeded' });
      expect(toProjectListEntry).not.toHaveBeenCalled();
    });

  });

  describe('refreshProjectList', () => {
    it('reloads projects from manifest', () => {
      const { result } = renderProjectStorage();

      // Update manifest to return different data
      const newEntry = makeManifestEntry({ localId: 'new-project', name: 'New' });
      (loadManifest as Mock).mockReturnValue({ version: 1, projects: [newEntry] });

      act(() => {
        result.current.actions.refreshProjectList();
      });

      expect(result.current.state.projects).toHaveLength(1);
      expect(result.current.state.projects[0].localId).toBe('new-project');
    });
  });

  describe('getActiveProject', () => {
    it('returns stored project for active localId', () => {
      const project = makeStoredProject();
      (loadProject as Mock).mockReturnValue(project);

      const { result } = renderProjectStorage(TEST_LOCAL_ID);

      let active: StoredLocalProject | null;
      act(() => {
        active = result.current.actions.getActiveProject();
      });

      expect(active!).toBe(project);
      expect(loadProject).toHaveBeenCalledWith(TEST_LOCAL_ID);
    });

    it('returns null when no active project', () => {
      const { result } = renderProjectStorage(null);

      let active: StoredLocalProject | null;
      act(() => {
        active = result.current.actions.getActiveProject();
      });

      expect(active!).toBeNull();
      expect(loadProject).not.toHaveBeenCalled();
    });
  });

  describe('sessionStorage persistence', () => {
    it('clears sessionStorage when activeLocalId is set to null', () => {
      sessionStorage.setItem('register-viewer-active-project', TEST_LOCAL_ID);
      (getMostRecentProjectId as Mock).mockReturnValue(null);

      const { result } = renderProjectStorage(TEST_LOCAL_ID);

      act(() => {
        result.current.actions.deleteLocalProject(TEST_LOCAL_ID);
      });

      expect(sessionStorage.getItem('register-viewer-active-project')).toBeNull();
    });
  });
});
