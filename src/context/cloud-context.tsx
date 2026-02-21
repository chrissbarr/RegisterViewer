import { createContext, useContext, useCallback, useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import { exportToJson } from '../utils/storage';
import {
  isCloudEnabled,
  createProject,
  updateProject,
  deleteProject as apiDeleteProject,
} from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import {
  getOrCreateOwnerToken,
  hashOwnerToken,
  checkOwnership,
  getOwnerTokenForProject,
} from '../utils/owner-token';
import {
  addLocalProject,
  removeLocalProject,
  updateLocalProject,
} from '../utils/cloud-projects';

export interface CloudProjectState {
  projectId: string | null;
  isOwner: boolean;
  isDirty: boolean;
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastSavedAt: string | null;
}

interface CloudActions {
  save: () => Promise<void>;
  fork: () => Promise<void>;
  deleteCloud: () => Promise<void>;
  setProjectId: (id: string, isOwner: boolean, shareUrl?: string | null) => void;
  clearCloud: () => void;
  dismissError: () => void;
}

const CloudProjectStateContext = createContext<CloudProjectState | null>(null);
const CloudActionsContext = createContext<CloudActions | null>(null);

interface InternalCloudState {
  projectId: string | null;
  isOwner: boolean;
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastSavedAt: string | null;
  lastSavedVersion: number;
}

const initialInternalState: InternalCloudState = {
  projectId: null,
  isOwner: false,
  status: 'idle',
  error: null,
  shareUrl: null,
  lastSavedAt: null,
  lastSavedVersion: -1,
};

export function CloudProjectProvider({ children }: { children: ReactNode }) {
  const appState = useAppState();
  const dispatch = useAppDispatch();

  const [internal, setInternal] = useState<InternalCloudState>(initialInternalState);

  // P-1: O(1) dirty tracking via generation counter instead of full JSON serialization.
  // Increments whenever data-bearing state properties change (reference comparison).
  const dataVersionRef = useRef(0);
  const [dataVersion, setDataVersion] = useState(0);

  useEffect(() => {
    dataVersionRef.current++;
    setDataVersion(dataVersionRef.current);
  }, [appState.registers, appState.registerValues, appState.project, appState.addressUnitBits]);

  const isDirty = internal.projectId !== null
    && internal.lastSavedVersion >= 0
    && dataVersion !== internal.lastSavedVersion;

  // P-3: Use appStateRef so save/fork callbacks don't need appState in dependency arrays
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  });

  const createNewProject = async (errorLabel: string) => {
    const jsonPayload = exportToJson(appStateRef.current);
    setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
    try {
      const ownerToken = getOrCreateOwnerToken();
      const tokenHash = await hashOwnerToken(ownerToken);
      const result = await createProject(jsonPayload, tokenHash);

      const projectName = appStateRef.current.project?.title ?? 'Untitled';
      addLocalProject({
        id: result.id,
        ownerToken,
        name: projectName,
        savedAt: result.createdAt,
        shareUrl: result.shareUrl,
      });

      const shareUrl = `${window.location.href.split('#')[0]}#/p/${result.id}`;
      history.replaceState(null, '', `#/p/${result.id}`);

      setInternal((prev) => ({
        ...prev,
        projectId: result.id,
        isOwner: true,
        status: 'idle',
        shareUrl,
        lastSavedAt: result.createdAt,
        lastSavedVersion: dataVersionRef.current,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : errorLabel;
      setInternal((prev) => ({ ...prev, status: 'idle', error: message }));
    }
  };

  const save = useCallback(async () => {
    // P-7: Guard against concurrent saves
    if (!isCloudEnabled() || internal.status === 'saving') return;

    // If we have a project and are owner, update it
    if (internal.projectId && internal.isOwner) {
      const ownerToken = getOwnerTokenForProject(internal.projectId);
      if (!ownerToken) {
        setInternal((prev) => ({ ...prev, error: 'Owner token not found for this project.' }));
        return;
      }

      setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
      try {
        const jsonPayload = exportToJson(appStateRef.current);
        const tokenHash = await hashOwnerToken(ownerToken);
        const result = await updateProject(internal.projectId, jsonPayload, tokenHash);
        const projectName = appStateRef.current.project?.title ?? 'Untitled';
        updateLocalProject(internal.projectId, {
          name: projectName,
          savedAt: result.updatedAt,
        });
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          lastSavedAt: result.updatedAt,
          lastSavedVersion: dataVersionRef.current,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to update project.';
        setInternal((prev) => ({ ...prev, status: 'idle', error: message }));
      }
      return;
    }

    // Otherwise create new project
    await createNewProject('Failed to save project.');
  }, [internal.projectId, internal.isOwner, internal.status]);

  const fork = useCallback(async () => {
    if (!isCloudEnabled() || internal.status === 'saving') return;
    await createNewProject('Failed to save copy.');
  }, [internal.status]);

  const deleteCloud = useCallback(async () => {
    if (!internal.projectId || !internal.isOwner) return;

    const ownerToken = getOwnerTokenForProject(internal.projectId);
    if (!ownerToken) {
      setInternal((prev) => ({ ...prev, error: 'Owner token not found.' }));
      return;
    }

    setInternal((prev) => ({ ...prev, status: 'deleting', error: null }));
    try {
      const tokenHash = await hashOwnerToken(ownerToken);
      await apiDeleteProject(internal.projectId, tokenHash);
      removeLocalProject(internal.projectId);

      // Clear hash from URL
      history.replaceState(null, '', window.location.pathname + window.location.search);

      setInternal({ ...initialInternalState });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete project.';
      setInternal((prev) => ({ ...prev, status: 'idle', error: message }));
    }
  }, [internal.projectId, internal.isOwner]);

  // P-6: setProjectId now marks current dataVersion as saved, avoiding re-serialization
  const setProjectId = useCallback(
    (id: string, isOwner: boolean, shareUrl?: string | null) => {
      setInternal((prev) => ({
        ...prev,
        projectId: id,
        isOwner,
        shareUrl: shareUrl ?? `${window.location.href.split('#')[0]}#/p/${id}`,
        lastSavedVersion: dataVersionRef.current,
      }));
    },
    [],
  );

  const clearCloud = useCallback(() => {
    setInternal({ ...initialInternalState });
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  const dismissError = useCallback(() => {
    setInternal((prev) => ({ ...prev, error: null }));
  }, []);

  // Load project from API
  const loadProject = useCallback(
    async (id: string) => {
      setInternal((prev) => ({ ...prev, status: 'loading', error: null, projectId: id }));
      try {
        const importResult = await fetchAndParseCloudProject(id);

        dispatch({
          type: 'IMPORT_STATE',
          registers: importResult.registers,
          values: importResult.values,
          project: importResult.project,
          addressUnitBits: importResult.addressUnitBits,
        });

        const isOwner = checkOwnership(id);
        const shareUrl = `${window.location.href.split('#')[0]}#/p/${id}`;

        // P-6: After IMPORT_STATE dispatch, the dataVersionRef will increment on next render.
        // Use queueMicrotask so lastSavedVersion captures the post-dispatch version.
        queueMicrotask(() => {
          setInternal((prev) => ({
            ...prev,
            projectId: id,
            isOwner,
            status: 'idle',
            shareUrl,
            lastSavedAt: importResult.updatedAt,
            lastSavedVersion: dataVersionRef.current,
          }));
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load project.';
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          error: message,
        }));
      }
    },
    [dispatch],
  );

  // P-3: Memoize actions object to prevent cascading re-renders
  const actionsWithLoad = useMemo(
    () => ({ save, fork, deleteCloud, setProjectId, clearCloud, dismissError, loadProject }),
    [save, fork, deleteCloud, setProjectId, clearCloud, dismissError, loadProject],
  );

  // P-2: List individual properties as dependencies instead of entire internal object
  const providedState: CloudProjectState = useMemo(
    () => ({
      projectId: internal.projectId,
      isOwner: internal.isOwner,
      isDirty,
      status: internal.status,
      error: internal.error,
      shareUrl: internal.shareUrl,
      lastSavedAt: internal.lastSavedAt,
    }),
    [
      internal.projectId,
      internal.isOwner,
      isDirty,
      internal.status,
      internal.error,
      internal.shareUrl,
      internal.lastSavedAt,
    ],
  );

  return (
    <CloudProjectStateContext.Provider value={providedState}>
      <CloudActionsContext.Provider value={actionsWithLoad}>
        {children}
      </CloudActionsContext.Provider>
    </CloudProjectStateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCloudProject(): CloudProjectState {
  const ctx = useContext(CloudProjectStateContext);
  if (!ctx) throw new Error('useCloudProject must be used within CloudProjectProvider');
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCloudActions(): CloudActions & { loadProject?: (id: string) => Promise<void> } {
  const ctx = useContext(CloudActionsContext);
  if (!ctx) throw new Error('useCloudActions must be used within CloudProjectProvider');
  return ctx as CloudActions & { loadProject?: (id: string) => Promise<void> };
}
