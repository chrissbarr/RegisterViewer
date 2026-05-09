import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import {
  loadManifest,
  loadProject,
  saveProject,
  createProject as createProjectInStorage,
  deleteProject,
  updateProjectMetadata,
  toProjectListEntry,
  getMostRecentProjectId,
  ACTIVE_PROJECT_SESSION_KEY,
  UNSAVED_SESSION_SENTINEL,
  clearUnsavedProject,
} from '../utils/project-storage';
import type { ProjectListEntry, StoredLocalProject, UnsavedProjectSource } from '../types/project';
import type { SerializedAppState } from '../types/register';
import { deserializeState, serializeState, EMPTY_SERIALIZED_STATE, type ImportResult } from '../utils/storage';
import { useEditActions } from './edit-context';

interface ProjectStorageState {
  activeLocalId: string | null;
  projects: ProjectListEntry[];
  isUnsaved: boolean;
  unsavedName: string | null;
}

interface CloudMetadataUpdates {
  cloudId?: string | null;
  cloudSavedAt?: string | null;
  visibility?: 'private' | 'unlisted';
  storage?: 'local' | 'cloud';
  serverVersion?: number | null;
}

interface ProjectStorageActions {
  createNewProject: (name?: string, initialState?: SerializedAppState) => string;
  switchProject: (localId: string) => void;
  deleteLocalProject: (localId: string) => void;
  renameProject: (localId: string, name: string) => void;
  refreshProjectList: () => void;
  getActiveProject: () => StoredLocalProject | null;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdates) => void;
  loadAsUnsaved: (result: ImportResult, name: string, source?: UnsavedProjectSource) => void;
  saveCurrentProject: (name?: string) => string;
  discardUnsavedProject: () => void;
}

const ProjectStorageStateContext = createContext<ProjectStorageState | null>(null);
const ProjectStorageActionsContext = createContext<ProjectStorageActions | null>(null);

interface ProjectStorageProviderProps {
  children: ReactNode;
  initialLocalId: string | null;
  initialUnsaved?: { name: string; source: UnsavedProjectSource } | null;
}

export function ProjectStorageProvider({ children, initialLocalId, initialUnsaved }: ProjectStorageProviderProps) {
  const appState = useAppState();
  const dispatch = useAppDispatch();
  const { exitEditMode } = useEditActions();

  const [activeLocalId, setActiveLocalId] = useState<string | null>(() => {
    // Unsaved projects have no localId
    if (initialUnsaved) return null;
    // Try initialLocalId first, then sessionStorage
    if (initialLocalId) return initialLocalId;
    try {
      const sessionId = sessionStorage.getItem(ACTIVE_PROJECT_SESSION_KEY);
      // Don't restore the unsaved sentinel as a localId
      if (sessionId === UNSAVED_SESSION_SENTINEL) return null;
      return sessionId;
    } catch {
      return null;
    }
  });

  const [projects, setProjects] = useState<ProjectListEntry[]>(() => {
    const manifest = loadManifest();
    return manifest.projects.map(toProjectListEntry);
  });

  const [isUnsaved, setIsUnsaved] = useState<boolean>(() => !!initialUnsaved);
  const [unsavedName, setUnsavedName] = useState<string | null>(() => initialUnsaved?.name ?? null);
  const unsavedSourceRef = useRef<UnsavedProjectSource>(initialUnsaved?.source ?? 'new');

  const refreshProjectList = useCallback(() => {
    const manifest = loadManifest();
    setProjects(manifest.projects.map(toProjectListEntry));
  }, []);

  const setActiveAndPersist = useCallback((localId: string | null, sentinel?: string) => {
    setActiveLocalId(localId);
    try {
      if (sentinel) {
        sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, sentinel);
      } else if (localId) {
        sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, localId);
      } else {
        sessionStorage.removeItem(ACTIVE_PROJECT_SESSION_KEY);
      }
    } catch {
      // sessionStorage unavailable
    }
  }, []);

  const createNewProject = useCallback((name?: string, initialState?: SerializedAppState) => {
    let state = initialState ?? EMPTY_SERIALIZED_STATE;
    // Autofill date to today if not already set
    if (!state.project?.date) {
      const today = new Date().toISOString().slice(0, 10);
      state = { ...state, project: { ...state.project, date: today } };
    }
    const localId = createProjectInStorage(state, name);
    setActiveAndPersist(localId);
    refreshProjectList();
    return localId;
  }, [setActiveAndPersist, refreshProjectList]);

  const switchProject = useCallback((localId: string) => {
    const project = loadProject(localId);
    if (!project) return;

    dispatch({ type: 'LOAD_STATE', state: deserializeState(project.state) });
    setActiveAndPersist(localId);

    // Clear unsaved state when switching to a saved project
    setIsUnsaved(false);
    setUnsavedName(null);
  }, [dispatch, setActiveAndPersist]);

  const deleteLocalProject = useCallback((localId: string) => {
    deleteProject(localId);

    // If we just deleted the active project, switch to most recent remaining
    if (localId === activeLocalId) {
      setActiveAndPersist(getMostRecentProjectId());
    }

    refreshProjectList();
  }, [activeLocalId, setActiveAndPersist, refreshProjectList]);

  const projectRef = useRef(appState.project);
  useEffect(() => {
    projectRef.current = appState.project;
  }, [appState.project]);

  const renameProject = useCallback((localId: string, name: string) => {
    // Update both manifest name and state.project.title in one write
    const project = loadProject(localId);
    if (project) {
      saveProject({
        ...project,
        name,
        state: {
          ...project.state,
          project: { ...project.state.project, title: name },
        },
      });
    }
    // If renaming the active project, also update in-memory AppState
    if (localId === activeLocalId) {
      dispatch({ type: 'SET_PROJECT_METADATA', project: { ...projectRef.current, title: name } });
    }
    refreshProjectList();
  }, [activeLocalId, dispatch, refreshProjectList]);

  const updateCloudMetadata = useCallback((localId: string, updates: CloudMetadataUpdates) => {
    // updateProjectMetadata saves the project record and updates the manifest in one pass
    updateProjectMetadata(localId, updates);
    refreshProjectList();
  }, [refreshProjectList]);

  const getActiveProject = useCallback((): StoredLocalProject | null => {
    if (!activeLocalId) return null;
    return loadProject(activeLocalId);
  }, [activeLocalId]);

  // Refs for appState/unsavedName so saveCurrentProject can access current state
  const appStateRef = useRef(appState);
  useEffect(() => { appStateRef.current = appState; }, [appState]);

  const unsavedNameRef = useRef(unsavedName);
  useEffect(() => { unsavedNameRef.current = unsavedName; }, [unsavedName]);

  const loadAsUnsaved = useCallback((
    result: ImportResult,
    name: string,
    source: UnsavedProjectSource = 'new',
  ) => {
    exitEditMode();
    dispatch({
      type: 'IMPORT_STATE',
      registers: result.registers,
      values: result.values,
      project: result.project,
      addressUnitBits: result.addressUnitBits,
    });

    setActiveAndPersist(null, UNSAVED_SESSION_SENTINEL);
    setIsUnsaved(true);
    setUnsavedName(name);
    unsavedSourceRef.current = source;
    // Auto-save effect will persist to register-viewer-unsaved on next tick
  }, [dispatch, exitEditMode, setActiveAndPersist]);

  const saveCurrentProject = useCallback((name?: string): string => {
    const serialized = serializeState(appStateRef.current);
    const projectName = name ?? unsavedNameRef.current ?? 'Untitled Project';

    // Autofill date if not set
    let state = serialized;
    if (!state.project?.date) {
      const today = new Date().toISOString().slice(0, 10);
      state = { ...state, project: { ...state.project, date: today } };
    }

    const localId = createProjectInStorage(state, projectName);
    clearUnsavedProject();
    setActiveAndPersist(localId);
    setIsUnsaved(false);
    setUnsavedName(null);
    refreshProjectList();
    return localId;
  }, [setActiveAndPersist, refreshProjectList]);

  const discardUnsavedProject = useCallback(() => {
    clearUnsavedProject();
    setIsUnsaved(false);
    setUnsavedName(null);

    const mostRecentId = getMostRecentProjectId();
    if (mostRecentId) {
      switchProject(mostRecentId);
    }
    // If no saved projects exist, the caller is responsible for what happens next
    // (e.g., the guard's pending action will create a new unsaved project)
  }, [switchProject]);

  const state = useMemo<ProjectStorageState>(
    () => ({ activeLocalId, projects, isUnsaved, unsavedName }),
    [activeLocalId, projects, isUnsaved, unsavedName],
  );

  const actions = useMemo<ProjectStorageActions>(
    () => ({ createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject, updateCloudMetadata, loadAsUnsaved, saveCurrentProject, discardUnsavedProject }),
    [createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject, updateCloudMetadata, loadAsUnsaved, saveCurrentProject, discardUnsavedProject],
  );

  return (
    <ProjectStorageStateContext.Provider value={state}>
      <ProjectStorageActionsContext.Provider value={actions}>
        {children}
      </ProjectStorageActionsContext.Provider>
    </ProjectStorageStateContext.Provider>
  );
}

export function useProjectStorage(): ProjectStorageState {
  const ctx = useContext(ProjectStorageStateContext);
  if (!ctx) throw new Error('useProjectStorage must be used within ProjectStorageProvider');
  return ctx;
}

export function useProjectStorageActions(): ProjectStorageActions {
  const ctx = useContext(ProjectStorageActionsContext);
  if (!ctx) throw new Error('useProjectStorageActions must be used within ProjectStorageProvider');
  return ctx;
}

