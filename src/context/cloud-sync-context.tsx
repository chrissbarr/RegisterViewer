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
  buildProjectUrl,
  removeLocalProject,
  updateLocalProject,
} from '../utils/cloud-projects';
import type { Visibility } from '../types/project';

interface CloudSyncState {
  cloudId: string | null;
  isOwner: boolean;
  isDirty: boolean;
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastCloudSavedAt: string | null;
  visibility: Visibility;
}

interface CloudSyncActions {
  saveToCloud: () => Promise<void>;
  deleteFromCloud: () => Promise<void>;
  setVisibility: (v: Visibility) => Promise<void>;
  loadCloudProject: (cloudId: string) => Promise<void>;
  fork: () => Promise<void>;
  dismissError: () => void;
  initFromProject: (cloudId: string | null, isOwner: boolean) => void;
}

const CloudSyncStateContext = createContext<CloudSyncState | null>(null);
const CloudSyncActionsContext = createContext<CloudSyncActions | null>(null);

interface InternalCloudSyncState {
  cloudId: string | null;
  isOwner: boolean;
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastCloudSavedAt: string | null;
  lastSavedVersion: number;
  visibility: Visibility;
}

const initialInternalState: InternalCloudSyncState = {
  cloudId: null,
  isOwner: false,
  status: 'idle',
  error: null,
  shareUrl: null,
  lastCloudSavedAt: null,
  lastSavedVersion: -1,
  visibility: 'private',
};

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const appState = useAppState();
  const dispatch = useAppDispatch();

  const [internal, setInternal] = useState<InternalCloudSyncState>(initialInternalState);

  // Generation counter dirty tracking (same pattern as old CloudProjectProvider)
  const mutationLockRef = useRef(false);
  const dataVersionRef = useRef(0);
  const [dataVersion, setDataVersion] = useState(0);
  const needsVersionSyncRef = useRef(false);

  useEffect(() => {
    dataVersionRef.current++;
    setDataVersion(dataVersionRef.current);

    if (needsVersionSyncRef.current) {
      needsVersionSyncRef.current = false;
      const capturedVersion = dataVersionRef.current;
      setInternal((prev) => ({ ...prev, lastSavedVersion: capturedVersion }));
    }
  }, [appState.registers, appState.registerValues, appState.project, appState.addressUnitBits]);

  const isDirty = internal.cloudId !== null
    && internal.lastSavedVersion >= 0
    && dataVersion !== internal.lastSavedVersion;

  // Ref to avoid stale closures in save/fork callbacks
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  });

  const createNewCloudProject = async (errorLabel: string) => {
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
        shareUrl: buildProjectUrl(result.id),
      });

      const shareUrl = buildProjectUrl(result.id);
      history.replaceState(null, '', `#/p/${result.id}`);

      setInternal((prev) => ({
        ...prev,
        cloudId: result.id,
        isOwner: true,
        status: 'idle',
        shareUrl,
        lastCloudSavedAt: result.createdAt,
        lastSavedVersion: dataVersionRef.current,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : errorLabel;
      setInternal((prev) => ({ ...prev, status: 'idle', error: message }));
    }
  };

  const saveToCloud = useCallback(async () => {
    if (!isCloudEnabled() || mutationLockRef.current) return;
    mutationLockRef.current = true;
    try {
      // If we have a cloud project and are owner, update it
      if (internal.cloudId && internal.isOwner) {
        const ownerToken = getOwnerTokenForProject(internal.cloudId);
        if (!ownerToken) {
          setInternal((prev) => ({ ...prev, error: 'Owner token not found for this project.' }));
          return;
        }

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const jsonPayload = exportToJson(appStateRef.current);
        const tokenHash = await hashOwnerToken(ownerToken);
        const result = await updateProject(internal.cloudId, jsonPayload, tokenHash);
        const projectName = appStateRef.current.project?.title ?? 'Untitled';
        updateLocalProject(internal.cloudId, {
          name: projectName,
          savedAt: result.updatedAt,
        });
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          lastCloudSavedAt: result.updatedAt,
          lastSavedVersion: dataVersionRef.current,
        }));
        return;
      }

      // Otherwise create new cloud project
      await createNewCloudProject('Failed to save project.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save project.';
      setInternal((prev) => ({ ...prev, status: 'idle', error: message }));
    } finally {
      mutationLockRef.current = false;
    }
  }, [internal.cloudId, internal.isOwner]);

  const fork = useCallback(async () => {
    if (!isCloudEnabled() || mutationLockRef.current) return;
    mutationLockRef.current = true;
    try {
      await createNewCloudProject('Failed to save copy.');
    } finally {
      mutationLockRef.current = false;
    }
  }, []);

  const deleteFromCloud = useCallback(async () => {
    if (!internal.cloudId || mutationLockRef.current) return;
    mutationLockRef.current = true;
    try {
      const ownerToken = getOwnerTokenForProject(internal.cloudId);
      if (!ownerToken) {
        throw new Error('Owner token not found.');
      }

      const tokenHash = await hashOwnerToken(ownerToken);
      await apiDeleteProject(internal.cloudId, tokenHash);
      removeLocalProject(internal.cloudId);

      // Clean up cloud state and URL
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setInternal({ ...initialInternalState });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete project.';
      throw new Error(message);
    } finally {
      mutationLockRef.current = false;
    }
  }, [internal.cloudId]);

  const setVisibility = useCallback(async (v: Visibility) => {
    // Stub: update local state only. Phase 4 adds API support.
    setInternal((prev) => ({ ...prev, visibility: v }));
  }, []);

  const initFromProject = useCallback(
    (cloudId: string | null, isOwner: boolean) => {
      if (cloudId === null) {
        // Clear cloud state (replaces old clearCloud)
        setInternal({ ...initialInternalState });
        history.replaceState(null, '', window.location.pathname + window.location.search);
      } else {
        setInternal((prev) => ({
          ...prev,
          cloudId,
          isOwner,
          shareUrl: buildProjectUrl(cloudId),
          lastSavedVersion: dataVersionRef.current,
          lastCloudSavedAt: null,
          error: null,
        }));
      }
    },
    [],
  );

  const dismissError = useCallback(() => {
    setInternal((prev) => ({ ...prev, error: null }));
  }, []);

  const loadCloudProject = useCallback(
    async (cloudId: string) => {
      setInternal((prev) => ({ ...prev, status: 'loading', error: null, cloudId }));
      try {
        const importResult = await fetchAndParseCloudProject(cloudId);

        dispatch({
          type: 'IMPORT_STATE',
          registers: importResult.registers,
          values: importResult.values,
          project: importResult.project,
          addressUnitBits: importResult.addressUnitBits,
        });

        const isOwner = checkOwnership(cloudId);
        const shareUrl = buildProjectUrl(cloudId);

        // Signal the version-tracking useEffect to capture lastSavedVersion
        needsVersionSyncRef.current = true;

        setInternal((prev) => ({
          ...prev,
          cloudId,
          isOwner,
          status: 'idle',
          shareUrl,
          lastCloudSavedAt: importResult.updatedAt,
        }));
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load project.';
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          error: message,
        }));
        throw err;
      }
    },
    [dispatch],
  );

  const actions = useMemo(
    () => ({ saveToCloud, deleteFromCloud, setVisibility, loadCloudProject, fork, dismissError, initFromProject }),
    [saveToCloud, deleteFromCloud, setVisibility, loadCloudProject, fork, dismissError, initFromProject],
  );

  const providedState: CloudSyncState = useMemo(
    () => ({
      cloudId: internal.cloudId,
      isOwner: internal.isOwner,
      isDirty,
      status: internal.status,
      error: internal.error,
      shareUrl: internal.shareUrl,
      lastCloudSavedAt: internal.lastCloudSavedAt,
      visibility: internal.visibility,
    }),
    [
      internal.cloudId,
      internal.isOwner,
      isDirty,
      internal.status,
      internal.error,
      internal.shareUrl,
      internal.lastCloudSavedAt,
      internal.visibility,
    ],
  );

  return (
    <CloudSyncStateContext.Provider value={providedState}>
      <CloudSyncActionsContext.Provider value={actions}>
        {children}
      </CloudSyncActionsContext.Provider>
    </CloudSyncStateContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCloudSync(): CloudSyncState {
  const ctx = useContext(CloudSyncStateContext);
  if (!ctx) throw new Error('useCloudSync must be used within CloudSyncProvider');
  return ctx;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useCloudSyncActions(): CloudSyncActions {
  const ctx = useContext(CloudSyncActionsContext);
  if (!ctx) throw new Error('useCloudSyncActions must be used within CloudSyncProvider');
  return ctx;
}
