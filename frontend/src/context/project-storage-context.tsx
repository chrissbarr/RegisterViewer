import { createContext, useContext, useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import {
  loadManifest,
  loadProject,
  saveProject,
  createProject as createProjectInStorage,
  deleteProject,
  updateProjectMetadata,
  flushProjectState,
  toProjectListEntry,
  getMostRecentProjectId,
  ACTIVE_PROJECT_SESSION_KEY,
  UNSAVED_SESSION_SENTINEL,
  clearUnsavedProject,
  type ProjectStorageWriteResult,
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
  unsavedSource: UnsavedProjectSource | null;
  lastDeparture: ProjectDepartureSnapshot | null;
}

interface CloudMetadataUpdates {
  cloudId?: string | null;
  cloudSavedAt?: string | null;
  visibility?: 'private' | 'unlisted';
  storage?: 'local' | 'cloud';
  serverVersion?: number | null;
  cloudConflictVersion?: number | null;
  hasUnsyncedChanges?: boolean;
}

interface CloudMetadataWriteOptions {
  preserveLocalSavedAt?: boolean;
}

interface ProjectStorageActions {
  createNewProject: (name?: string, initialState?: SerializedAppState) => string | null;
  switchProject: (localId: string) => boolean;
  deleteLocalProject: (localId: string) => void;
  renameProject: (localId: string, name: string) => void;
  refreshProjectList: () => void;
  getActiveProject: () => StoredLocalProject | null;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdates, options?: CloudMetadataWriteOptions) => ProjectStorageWriteResult;
  loadAsUnsaved: (result: ImportResult, name: string, source?: UnsavedProjectSource) => boolean;
  saveCurrentProject: (name?: string) => string | null;
  discardUnsavedProject: () => void;
  registerDepartureSnapshotter: (snapshotter: DepartureSnapshotter | null) => void;
}

interface ProjectDepartureMeta {
  localId: string;
  cloudId: string | null;
  storage: 'local' | 'cloud';
  serverVersion: number | null;
  cloudConflictVersion: number | null;
  cloudSavedAt: string | null;
  visibility: 'private' | 'unlisted';
}

export interface ProjectDepartureSnapshot extends ProjectDepartureMeta {
  sequence: number;
  wasDirty: boolean;
}

type DepartureSnapshotter = (meta: ProjectDepartureMeta) => Pick<ProjectDepartureSnapshot, 'wasDirty' | 'serverVersion'> | null;

type DepartureFlushResult =
  | { ok: true; departure: ProjectDepartureSnapshot | null }
  | { ok: false; result: ProjectStorageWriteResult };

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
    return initialLocalId;
  });

  const [projects, setProjects] = useState<ProjectListEntry[]>(() => {
    const manifest = loadManifest();
    return manifest.projects.map(toProjectListEntry);
  });

  const [isUnsaved, setIsUnsaved] = useState<boolean>(() => !!initialUnsaved);
  const [unsavedName, setUnsavedName] = useState<string | null>(() => initialUnsaved?.name ?? null);
  const [unsavedSource, setUnsavedSource] = useState<UnsavedProjectSource | null>(() => initialUnsaved?.source ?? null);
  const [lastDeparture, setLastDeparture] = useState<ProjectDepartureSnapshot | null>(null);
  const departureSequenceRef = useRef(0);
  const departureSnapshotterRef = useRef<DepartureSnapshotter | null>(null);

  const activeLocalIdRef = useRef(activeLocalId);
  const isUnsavedRef = useRef(isUnsaved);
  const appStateRef = useRef(appState);

  useEffect(() => { activeLocalIdRef.current = activeLocalId; }, [activeLocalId]);
  useEffect(() => { isUnsavedRef.current = isUnsaved; }, [isUnsaved]);
  useEffect(() => { appStateRef.current = appState; }, [appState]);

  const refreshProjectList = useCallback(() => {
    const manifest = loadManifest();
    setProjects(manifest.projects.map(toProjectListEntry));
  }, []);

  const setActiveAndPersist = useCallback((localId: string | null, sentinel?: string) => {
    activeLocalIdRef.current = localId;
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

  const flushDepartingSavedProject = useCallback((protectedLocalIds: readonly (string | null | undefined)[] = []): DepartureFlushResult => {
    const departingLocalId = activeLocalIdRef.current;
    if (!departingLocalId || isUnsavedRef.current) return { ok: true, departure: null };

    const flushOptions = protectedLocalIds.some(Boolean) ? { protectedLocalIds } : undefined;
    const flushResult = flushProjectState(departingLocalId, serializeState(appStateRef.current), flushOptions);
    if (!flushResult.ok || !flushResult.project) {
      if (flushResult.status === 'missing') {
        const stillManifested = loadManifest().projects.some(p => p.localId === departingLocalId);
        if (!stillManifested) {
          setLastDeparture(null);
          return { ok: true, departure: null };
        }
      }
      if (import.meta.env.DEV) {
        console.warn('[project-storage-context] Failed to flush departing project:', departingLocalId, flushResult.status, flushResult.error);
      }
      return { ok: false, result: flushResult };
    }
    const flushed = flushResult.project;

    const meta: ProjectDepartureMeta = {
      localId: flushed.localId,
      cloudId: flushed.cloudId,
      storage: flushed.storage,
      serverVersion: flushed.serverVersion ?? null,
      cloudConflictVersion: flushed.cloudConflictVersion ?? null,
      cloudSavedAt: flushed.cloudSavedAt,
      visibility: flushed.visibility,
    };
    const snapshot = departureSnapshotterRef.current?.(meta);
    const departure: ProjectDepartureSnapshot = {
      ...meta,
      sequence: ++departureSequenceRef.current,
      wasDirty: snapshot?.wasDirty ?? false,
      serverVersion: snapshot?.serverVersion ?? meta.serverVersion,
    };
    setLastDeparture(departure);
    return { ok: true, departure };
  }, []);

  const createNewProject = useCallback((name?: string, initialState?: SerializedAppState) => {
    const departure = flushDepartingSavedProject();
    if (!departure.ok) return null;
    let state = initialState ?? EMPTY_SERIALIZED_STATE;
    // Autofill date to today if not already set
    if (!state.project?.date) {
      const today = new Date().toISOString().slice(0, 10);
      state = { ...state, project: { ...state.project, date: today } };
    }
    let localId: string;
    try {
      localId = createProjectInStorage(state, name, undefined, {
        protectedLocalIds: [activeLocalIdRef.current],
      });
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[project-storage-context] Failed to create project:', err);
      }
      return null;
    }
    setActiveAndPersist(localId);
    refreshProjectList();
    return localId;
  }, [flushDepartingSavedProject, setActiveAndPersist, refreshProjectList]);

  const switchProject = useCallback((localId: string): boolean => {
    const project = loadProject(localId);
    if (!project) return false;

    if (localId !== activeLocalIdRef.current) {
      const departure = flushDepartingSavedProject([localId]);
      if (!departure.ok) return false;
    }

    dispatch({ type: 'LOAD_STATE', state: deserializeState(project.state) });
    setActiveAndPersist(localId);

    // Clear unsaved state when switching to a saved project
    setIsUnsaved(false);
    isUnsavedRef.current = false;
    setUnsavedName(null);
    setUnsavedSource(null);
    return true;
  }, [dispatch, flushDepartingSavedProject, setActiveAndPersist]);

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
    let saved = false;
    if (project) {
      const result = saveProject({
        ...project,
        name,
        hasUnsyncedChanges: project.storage === 'cloud' ? true : project.hasUnsyncedChanges,
        state: {
          ...project.state,
          project: { ...project.state.project, title: name },
        },
      }, { protectedLocalIds: [activeLocalIdRef.current] });
      saved = result.ok;
    }
    // If renaming the active project, also update in-memory AppState after durable write.
    if (saved && localId === activeLocalId) {
      dispatch({ type: 'SET_PROJECT_METADATA', project: { ...projectRef.current, title: name } });
    }
    if (saved) refreshProjectList();
  }, [activeLocalId, dispatch, refreshProjectList]);

  const updateCloudMetadata = useCallback((
    localId: string,
    updates: CloudMetadataUpdates,
    options?: CloudMetadataWriteOptions,
  ): ProjectStorageWriteResult => {
    // updateProjectMetadata saves the project record and updates the manifest in one pass
    const storageOptions = {
      protectedLocalIds: [activeLocalIdRef.current],
      ...(options?.preserveLocalSavedAt ? { preserveLocalSavedAt: true } : {}),
    };
    const result = updateProjectMetadata(localId, updates, {
      ...storageOptions,
    });
    if (result.ok && !result.unchanged) {
      refreshProjectList();
    }
    return result;
  }, [refreshProjectList]);

  const getActiveProject = useCallback((): StoredLocalProject | null => {
    if (!activeLocalId) return null;
    return loadProject(activeLocalId);
  }, [activeLocalId]);

  // Ref for unsavedName so saveCurrentProject can access current state.
  const unsavedNameRef = useRef(unsavedName);
  useEffect(() => { unsavedNameRef.current = unsavedName; }, [unsavedName]);

  const loadAsUnsaved = useCallback((
    result: ImportResult,
    name: string,
    source: UnsavedProjectSource = 'new',
  ) => {
    exitEditMode();
    const departure = flushDepartingSavedProject();
    if (!departure.ok) return false;
    dispatch({
      type: 'IMPORT_STATE',
      registers: result.registers,
      values: result.values,
      project: result.project,
      addressUnitBits: result.addressUnitBits,
    });

    setActiveAndPersist(null, UNSAVED_SESSION_SENTINEL);
    setIsUnsaved(true);
    isUnsavedRef.current = true;
    setUnsavedName(name);
    setUnsavedSource(source);
    // Auto-save effect will persist to register-viewer-unsaved on next tick
    return true;
  }, [dispatch, exitEditMode, flushDepartingSavedProject, setActiveAndPersist]);

  const saveCurrentProject = useCallback((name?: string): string | null => {
    const serialized = serializeState(appStateRef.current);
    const projectName = name ?? unsavedNameRef.current ?? 'Untitled Project';

    // Autofill date if not set
    let state = serialized;
    if (!state.project?.date) {
      const today = new Date().toISOString().slice(0, 10);
      state = { ...state, project: { ...state.project, date: today } };
    }

    let localId: string;
    try {
      localId = createProjectInStorage(state, projectName, undefined, {
        protectedLocalIds: [activeLocalIdRef.current],
      });
    } catch (err) {
      if (import.meta.env.DEV) {
        console.warn('[project-storage-context] Failed to save current project:', err);
      }
      return null;
    }
    clearUnsavedProject();
    setActiveAndPersist(localId);
    setIsUnsaved(false);
    isUnsavedRef.current = false;
    setUnsavedName(null);
    setUnsavedSource(null);
    refreshProjectList();
    return localId;
  }, [setActiveAndPersist, refreshProjectList]);

  const discardUnsavedProject = useCallback(() => {
    clearUnsavedProject();
    setIsUnsaved(false);
    isUnsavedRef.current = false;
    setUnsavedName(null);
    setUnsavedSource(null);

    const mostRecentId = getMostRecentProjectId();
    if (mostRecentId) {
      switchProject(mostRecentId);
    }
    // If no saved projects exist, the caller is responsible for what happens next
    // (e.g., the guard's pending action will create a new unsaved project)
  }, [switchProject]);

  const registerDepartureSnapshotter = useCallback((snapshotter: DepartureSnapshotter | null) => {
    departureSnapshotterRef.current = snapshotter;
  }, []);

  const state = useMemo<ProjectStorageState>(
    () => ({ activeLocalId, projects, isUnsaved, unsavedName, unsavedSource: isUnsaved ? unsavedSource : null, lastDeparture }),
    [activeLocalId, projects, isUnsaved, unsavedName, unsavedSource, lastDeparture],
  );

  const actions = useMemo<ProjectStorageActions>(
    () => ({ createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject, updateCloudMetadata, loadAsUnsaved, saveCurrentProject, discardUnsavedProject, registerDepartureSnapshotter }),
    [createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList, getActiveProject, updateCloudMetadata, loadAsUnsaved, saveCurrentProject, discardUnsavedProject, registerDepartureSnapshotter],
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

