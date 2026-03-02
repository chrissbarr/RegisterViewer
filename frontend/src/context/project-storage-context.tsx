import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import {
  loadManifest,
  loadProject,
  createProject as createProjectInStorage,
  deleteProject,
  updateProjectMetadata,
  toProjectListEntry,
  getMostRecentProjectId,
  ACTIVE_PROJECT_SESSION_KEY,
} from '../utils/project-storage';
import type { ProjectListEntry, StoredLocalProject } from '../types/project';
import type { SerializedAppState } from '../types/register';
import { deserializeState, EMPTY_SERIALIZED_STATE } from '../utils/storage';

interface ProjectStorageState {
  activeLocalId: string | null;
  projects: ProjectListEntry[];
}

interface CloudMetadataUpdates {
  cloudId?: string | null;
  cloudSavedAt?: string | null;
  visibility?: 'private' | 'unlisted';
}

interface ProjectStorageActions {
  createNewProject: (name?: string, initialState?: SerializedAppState) => string;
  switchProject: (localId: string) => void;
  deleteLocalProject: (localId: string) => void;
  renameProject: (localId: string, name: string) => void;
  refreshProjectList: () => void;
  getActiveProject: () => StoredLocalProject | null;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdates) => void;
}

const ProjectStorageStateContext = createContext<ProjectStorageState | null>(null);
const ProjectStorageActionsContext = createContext<ProjectStorageActions | null>(null);

interface ProjectStorageProviderProps {
  children: ReactNode;
  initialLocalId: string | null;
}

export function ProjectStorageProvider({ children, initialLocalId }: ProjectStorageProviderProps) {
  const appState = useAppState();
  const dispatch = useAppDispatch();

  const [activeLocalId, setActiveLocalId] = useState<string | null>(() => {
    // Try initialLocalId first, then sessionStorage
    if (initialLocalId) return initialLocalId;
    try {
      return sessionStorage.getItem(ACTIVE_PROJECT_SESSION_KEY);
    } catch {
      return null;
    }
  });

  const [projects, setProjects] = useState<ProjectListEntry[]>(() => {
    const manifest = loadManifest();
    return manifest.projects.map(toProjectListEntry);
  });

  const refreshProjectList = useCallback(() => {
    const manifest = loadManifest();
    setProjects(manifest.projects.map(toProjectListEntry));
  }, []);

  const setActiveAndPersist = useCallback((localId: string | null) => {
    setActiveLocalId(localId);
    try {
      if (localId) {
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
    updateProjectMetadata(localId, { name });
    // If renaming the active project, also update AppState.project.title
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

  const state = useMemo<ProjectStorageState>(
    () => ({ activeLocalId, projects }),
    [activeLocalId, projects],
  );

  const actions = useMemo<ProjectStorageActions>(
    () => ({ createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject, updateCloudMetadata }),
    [createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject, updateCloudMetadata],
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

