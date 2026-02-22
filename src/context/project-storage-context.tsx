import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { useAppDispatch } from './app-context';
import {
  loadManifest,
  loadProject,
  createProject as createProjectInStorage,
  deleteProject,
  updateProjectMetadata,
  toProjectListEntry,
} from '../utils/project-storage';
import type { ProjectListEntry, StoredLocalProject } from '../types/project';
import type { AppState, SerializedAppState } from '../types/register';
import { ADDRESS_UNIT_BITS_DEFAULT } from '../types/register';

const ACTIVE_PROJECT_SESSION_KEY = 'register-viewer-active-project';

interface ProjectStorageState {
  activeLocalId: string | null;
  projects: ProjectListEntry[];
}

interface ProjectStorageActions {
  createNewProject: (name?: string) => string;
  switchProject: (localId: string) => void;
  deleteLocalProject: (localId: string) => void;
  renameProject: (localId: string, name: string) => void;
  refreshProjectList: () => void;
  getActiveProject: () => StoredLocalProject | null;
}

const ProjectStorageStateContext = createContext<ProjectStorageState | null>(null);
const ProjectStorageActionsContext = createContext<ProjectStorageActions | null>(null);

interface ProjectStorageProviderProps {
  children: ReactNode;
  initialLocalId: string | null;
}

export function ProjectStorageProvider({ children, initialLocalId }: ProjectStorageProviderProps) {
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

  const createNewProject = useCallback((name?: string) => {
    const emptyState: SerializedAppState = {
      registers: [],
      activeRegisterId: null,
      registerValues: {},
      mapTableWidth: 32,
      mapShowGaps: true,
      mapSortDescending: false,
      addressUnitBits: ADDRESS_UNIT_BITS_DEFAULT,
    };
    const localId = createProjectInStorage(emptyState, name);
    setActiveAndPersist(localId);
    refreshProjectList();
    return localId;
  }, [setActiveAndPersist, refreshProjectList]);

  const switchProject = useCallback((localId: string) => {
    const project = loadProject(localId);
    if (!project) return;

    dispatch({ type: 'LOAD_STATE', state: deserializeState(project) });
    setActiveAndPersist(localId);
  }, [dispatch, setActiveAndPersist]);

  const deleteLocalProject = useCallback((localId: string) => {
    deleteProject(localId);

    // If we just deleted the active project, switch to most recent remaining
    if (localId === activeLocalId) {
      const manifest = loadManifest();
      const remaining = manifest.projects;
      if (remaining.length > 0) {
        const sorted = [...remaining].sort(
          (a, b) => new Date(b.localSavedAt).getTime() - new Date(a.localSavedAt).getTime(),
        );
        setActiveAndPersist(sorted[0].localId);
      } else {
        setActiveAndPersist(null);
      }
    }

    refreshProjectList();
  }, [activeLocalId, setActiveAndPersist, refreshProjectList]);

  const renameProject = useCallback((localId: string, name: string) => {
    updateProjectMetadata(localId, { name });
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
    () => ({ createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject }),
    [createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject],
  );

  return (
    <ProjectStorageStateContext.Provider value={state}>
      <ProjectStorageActionsContext.Provider value={actions}>
        {children}
      </ProjectStorageActionsContext.Provider>
    </ProjectStorageStateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectStorage(): ProjectStorageState {
  const ctx = useContext(ProjectStorageStateContext);
  if (!ctx) throw new Error('useProjectStorage must be used within ProjectStorageProvider');
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectStorageActions(): ProjectStorageActions {
  const ctx = useContext(ProjectStorageActionsContext);
  if (!ctx) throw new Error('useProjectStorageActions must be used within ProjectStorageProvider');
  return ctx;
}

/** Deserialize a StoredLocalProject's state into an AppState */
function deserializeState(project: StoredLocalProject): AppState {
  const s = project.state;
  const values: Record<string, bigint> = {};
  for (const [key, hex] of Object.entries(s.registerValues)) {
    try {
      values[key] = BigInt(hex);
    } catch {
      values[key] = 0n;
    }
  }
  return {
    registers: s.registers,
    activeRegisterId: s.activeRegisterId,
    registerValues: values,
    mapTableWidth: s.mapTableWidth ?? 32,
    mapShowGaps: s.mapShowGaps ?? true,
    mapSortDescending: s.mapSortDescending ?? false,
    addressUnitBits: s.addressUnitBits ?? 8,
    project: s.project,
  };
}
