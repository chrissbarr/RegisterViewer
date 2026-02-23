import { createContext, useContext, useCallback, useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import { useProjectStorage, useProjectStorageActions } from './project-storage-context';
import { exportToObject, deserializeState } from '../utils/storage';
import {
  isCloudEnabled,
  ApiError,
  createProject,
  updateProject,
  deleteProject as apiDeleteProject,
  listProjects,
} from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import {
  getOrCreateOwnerToken,
  hashOwnerToken,
  checkOwnership,
  getOwnerTokenForProject,
} from '../utils/owner-token';
import {
  loadManifest,
  saveManifest,
  loadProject,
  buildProjectUrl,
} from '../utils/project-storage';
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

interface SyncResult {
  updatedCount: number;
  staleCloudIds: string[];
}

interface CloudSyncActions {
  saveToCloud: () => Promise<void>;
  saveProjectToCloud: (localId: string) => Promise<void>;
  deleteFromCloud: () => Promise<void>;
  deleteProjectFromCloud: (cloudId: string) => Promise<void>;
  setVisibility: (v: Visibility) => Promise<void>;
  setProjectVisibility: (localId: string, v: Visibility) => Promise<void>;
  loadCloudProject: (cloudId: string) => Promise<void>;
  fork: () => Promise<void>;
  dismissError: () => void;
  initFromProject: (cloudId: string | null, isOwner: boolean) => void;
  syncCloudProjects: () => Promise<SyncResult>;
  unlinkCloudProject: (localId: string) => void;
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
  const { activeLocalId } = useProjectStorage();
  const { updateCloudMetadata } = useProjectStorageActions();

  const [internal, setInternal] = useState<InternalCloudSyncState>(initialInternalState);

  // Track activeLocalId in a ref for use in async callbacks
  const activeLocalIdRef = useRef(activeLocalId);
  useEffect(() => {
    activeLocalIdRef.current = activeLocalId;
  }, [activeLocalId]);

  // Generation counter dirty tracking (same pattern as old CloudProjectProvider)
  const mutationLockRef = useRef(false);
  const dataVersionRef = useRef(0);
  const needsVersionSyncRef = useRef(false);
  const prevDirtyRef = useRef(false);

  useEffect(() => {
    dataVersionRef.current++;

    if (needsVersionSyncRef.current) {
      needsVersionSyncRef.current = false;
      const capturedVersion = dataVersionRef.current;
      setInternal((prev) => ({ ...prev, lastSavedVersion: capturedVersion }));
      return;
    }

    // Only trigger a re-render when isDirty status actually changes (false → true)
    const nowDirty = internal.cloudId !== null
      && internal.lastSavedVersion >= 0
      && dataVersionRef.current !== internal.lastSavedVersion;
    if (nowDirty !== prevDirtyRef.current) {
      prevDirtyRef.current = nowDirty;
      // Force re-render by touching internal state
      setInternal((prev) => ({ ...prev }));
    }
  }, [appState.registers, appState.registerValues, appState.project, appState.addressUnitBits, internal.cloudId, internal.lastSavedVersion]);

  const isDirty = internal.cloudId !== null
    && internal.lastSavedVersion >= 0
    && dataVersionRef.current !== internal.lastSavedVersion;

  // Sync cloud state when active project changes (handles project switch)
  const internalRef = useRef(internal);
  useEffect(() => {
    internalRef.current = internal;
  });

  useEffect(() => {
    if (!activeLocalId) return;
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === activeLocalId);
    const cloudId = entry?.cloudId ?? null;
    // Skip if cloudId hasn't changed (avoid redundant state updates)
    if (cloudId === internalRef.current.cloudId) return;
    const isOwner = cloudId ? checkOwnership(cloudId) : false;
    if (cloudId === null) {
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
        visibility: entry?.visibility ?? 'private',
      }));
    }
  }, [activeLocalId]);

  // Ref to avoid stale closures in save/fork callbacks
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  });

  const createNewCloudProject = useCallback(async (errorLabel: string) => {
    const jsonPayload = exportToObject(appStateRef.current);
    setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
    try {
      const ownerToken = getOrCreateOwnerToken();
      const tokenHash = await hashOwnerToken(ownerToken);
      const result = await createProject(jsonPayload, tokenHash);

      // Update manifest and project record with new cloudId + ownerToken
      const currentLocalId = activeLocalIdRef.current;
      if (currentLocalId) {
        updateCloudMetadata(currentLocalId, {
          cloudId: result.id,
          cloudSavedAt: result.createdAt,
          ownerToken,
        });
      }

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
  }, [updateCloudMetadata]);

  const saveToCloud = useCallback(async () => {
    if (!isCloudEnabled() || mutationLockRef.current) return;
    mutationLockRef.current = true;
    try {
      const { cloudId, isOwner } = internalRef.current;
      // If we have a cloud project and are owner, update it
      if (cloudId && isOwner) {
        const ownerToken = getOwnerTokenForProject(cloudId);
        if (!ownerToken) {
          setInternal((prev) => ({ ...prev, error: 'Owner token not found for this project.' }));
          return;
        }

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const jsonPayload = exportToObject(appStateRef.current);
        const tokenHash = await hashOwnerToken(ownerToken);
        try {
          const result = await updateProject(cloudId, jsonPayload, tokenHash);

          // Update manifest cloudSavedAt
          const currentLocalId = activeLocalIdRef.current;
          if (currentLocalId) {
            updateCloudMetadata(currentLocalId, {
              cloudSavedAt: result.updatedAt,
            });
          }

          setInternal((prev) => ({
            ...prev,
            status: 'idle',
            lastCloudSavedAt: result.updatedAt,
            lastSavedVersion: dataVersionRef.current,
          }));
          return;
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            // Cloud project was deleted — clear cloudId and save as new
            // Clear manifest cloudId and ownerToken
            const currentLocalId = activeLocalIdRef.current;
            if (currentLocalId) {
              updateCloudMetadata(currentLocalId, {
                cloudId: null,
                visibility: 'private',
                cloudSavedAt: null,
                ownerToken: null,
              });
            }

            history.replaceState(null, '', window.location.pathname + window.location.search);
            setInternal((prev) => ({
              ...prev,
              cloudId: null,
              isOwner: false,
              status: 'idle',
              shareUrl: null,
              lastCloudSavedAt: null,
              visibility: 'private',
              error: 'Cloud project not found. It may have been deleted. Use "Save to Cloud" to create a new copy.',
            }));
            return;
          }
          throw err;
        }
      }

      // Otherwise create new cloud project
      await createNewCloudProject('Failed to save project.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save project.';
      setInternal((prev) => ({ ...prev, status: 'idle', error: message }));
    } finally {
      mutationLockRef.current = false;
    }
  }, [updateCloudMetadata, createNewCloudProject]);

  const fork = useCallback(async () => {
    if (!isCloudEnabled() || mutationLockRef.current) return;
    mutationLockRef.current = true;
    try {
      await createNewCloudProject('Failed to save copy.');
    } finally {
      mutationLockRef.current = false;
    }
  }, [createNewCloudProject]);

  // Save a specific project to cloud without switching active project.
  // Used by My Projects dialog for non-active projects.
  const saveProjectToCloud = useCallback(async (localId: string) => {
    if (!isCloudEnabled()) return;

    const project = loadProject(localId);
    if (!project) throw new Error('Project not found.');

    const projectState = deserializeState(project.state);
    const jsonPayload = exportToObject(projectState);
    const ownerToken = getOrCreateOwnerToken();
    const tokenHash = await hashOwnerToken(ownerToken);

    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === localId);
    const existingCloudId = entry?.cloudId ?? project.cloudId;

    if (existingCloudId) {
      // Update existing cloud project
      const existingOwnerToken = getOwnerTokenForProject(existingCloudId);
      if (!existingOwnerToken) throw new Error('Owner token not found.');
      const existingTokenHash = await hashOwnerToken(existingOwnerToken);
      const result = await updateProject(existingCloudId, jsonPayload, existingTokenHash);
      updateCloudMetadata(localId, { cloudSavedAt: result.updatedAt });
    } else {
      // Create new cloud project
      const result = await createProject(jsonPayload, tokenHash);
      updateCloudMetadata(localId, {
        cloudId: result.id,
        cloudSavedAt: result.createdAt,
        ownerToken,
      });

      // If this is the active project, update cloud state + URL
      if (localId === activeLocalIdRef.current) {
        history.replaceState(null, '', `#/p/${result.id}`);
        setInternal((prev) => ({
          ...prev,
          cloudId: result.id,
          isOwner: true,
          shareUrl: buildProjectUrl(result.id),
          lastCloudSavedAt: result.createdAt,
          lastSavedVersion: dataVersionRef.current,
        }));
      }
    }
  }, [updateCloudMetadata]);

  const deleteFromCloud = useCallback(async () => {
    const { cloudId } = internalRef.current;
    if (!cloudId || mutationLockRef.current) return;
    mutationLockRef.current = true;
    try {
      const ownerToken = getOwnerTokenForProject(cloudId);
      if (!ownerToken) {
        throw new Error('Owner token not found.');
      }

      const tokenHash = await hashOwnerToken(ownerToken);
      await apiDeleteProject(cloudId, tokenHash);

      // Update manifest: clear cloudId, set visibility to private
      const currentLocalId = activeLocalIdRef.current;
      if (currentLocalId) {
        updateCloudMetadata(currentLocalId, {
          cloudId: null,
          visibility: 'private',
          cloudSavedAt: null,
          ownerToken: null,
        });
      }

      // Clean up cloud state and URL
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setInternal({ ...initialInternalState });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete project.';
      throw new Error(message);
    } finally {
      mutationLockRef.current = false;
    }
  }, [updateCloudMetadata]);

  const setVisibility = useCallback(async (v: Visibility) => {
    const { cloudId, isOwner, visibility: previousVisibility } = internalRef.current;
    setInternal((prev) => ({ ...prev, visibility: v }));

    // If we have a cloud project, update visibility on the server
    if (cloudId && isOwner) {
      try {
        const ownerToken = getOwnerTokenForProject(cloudId);
        if (!ownerToken) return;

        const tokenHash = await hashOwnerToken(ownerToken);
        const jsonPayload = exportToObject(appStateRef.current);
        await updateProject(cloudId, jsonPayload, tokenHash, v);

        // Update the manifest entry's visibility
        const currentLocalId = activeLocalIdRef.current;
        if (currentLocalId) {
          updateCloudMetadata(currentLocalId, { visibility: v });
        }
      } catch {
        // Revert on failure
        setInternal((prev) => ({ ...prev, visibility: previousVisibility }));
      }
    }
  }, [updateCloudMetadata]);

  // Set visibility for a specific project by localId, without relying on active project state.
  // Used by My Projects dialog for non-active projects.
  const setProjectVisibility = useCallback(async (localId: string, v: Visibility) => {
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === localId);
    if (!entry?.cloudId) return;

    const ownerToken = getOwnerTokenForProject(entry.cloudId);
    if (!ownerToken) return;

    try {
      const tokenHash = await hashOwnerToken(ownerToken);
      // Load and serialize this project's state for the PUT body
      const project = loadProject(localId);
      if (!project) return;
      const projectState = deserializeState(project.state);
      const jsonPayload = exportToObject(projectState);
      await updateProject(entry.cloudId, jsonPayload, tokenHash, v);

      updateCloudMetadata(localId, { visibility: v });

      // If this is the active project, update cloud state too
      if (localId === activeLocalIdRef.current) {
        setInternal((prev) => ({ ...prev, visibility: v }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update visibility.';
      throw new Error(message);
    }
  }, [updateCloudMetadata]);

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
        if (err instanceof ApiError && err.status === 404) {
          setInternal((prev) => ({
            ...prev,
            status: 'idle',
            error: 'Project not found \u2014 it may have been deleted.',
            cloudId: null,
          }));
          return;
        }
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

  const syncCloudProjects = useCallback(async (): Promise<SyncResult> => {
    if (!isCloudEnabled()) return { updatedCount: 0, staleCloudIds: [] };

    try {
      const ownerToken = getOrCreateOwnerToken();
      const tokenHash = await hashOwnerToken(ownerToken);
      const response = await listProjects(tokenHash);

      const serverMap = new Map(response.projects.map(p => [p.id, p]));
      const manifest = loadManifest();
      let updatedCount = 0;
      const staleCloudIds: string[] = [];

      for (const entry of manifest.projects) {
        if (!entry.cloudId) continue;

        const serverProject = serverMap.get(entry.cloudId);
        if (serverProject) {
          // Match found — update cloudSavedAt if server has newer updatedAt
          const serverTime = new Date(serverProject.updatedAt).getTime();
          const localCloudTime = entry.cloudSavedAt ? new Date(entry.cloudSavedAt).getTime() : 0;
          if (serverTime > localCloudTime) {
            entry.cloudSavedAt = serverProject.updatedAt;
            updatedCount++;
          }
          // Also sync visibility from server
          if (serverProject.visibility !== entry.visibility) {
            entry.visibility = serverProject.visibility;
          }
        } else {
          // Local has cloudId but not on server — stale/deleted
          staleCloudIds.push(entry.cloudId);
        }
      }

      saveManifest(manifest);
      return { updatedCount, staleCloudIds };
    } catch {
      // Silently fail sync — not critical
      return { updatedCount: 0, staleCloudIds: [] };
    }
  }, []);

  const deleteProjectFromCloud = useCallback(async (cloudId: string) => {
    const ownerToken = getOwnerTokenForProject(cloudId);
    if (!ownerToken) {
      throw new Error('Owner token not found.');
    }

    const tokenHash = await hashOwnerToken(ownerToken);
    await apiDeleteProject(cloudId, tokenHash);

    // Update manifest: clear cloudId, set visibility to private
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.cloudId === cloudId);
    if (entry) {
      updateCloudMetadata(entry.localId, {
        cloudId: null,
        visibility: 'private',
        cloudSavedAt: null,
        ownerToken: null,
      });
    }

    // If the currently active cloud project is this one, clear cloud state
    // Use ref to avoid stale closure — internal.cloudId may be outdated
    if (internalRef.current.cloudId === cloudId) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setInternal({ ...initialInternalState });
    }
  }, [updateCloudMetadata]);

  const unlinkCloudProject = useCallback((localId: string) => {
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === localId);
    if (!entry || !entry.cloudId) return;

    const cloudId = entry.cloudId;
    updateCloudMetadata(localId, {
      cloudId: null,
      visibility: 'private',
      cloudSavedAt: null,
      ownerToken: null,
    });

    // If the currently active cloud project is this one, clear cloud state
    // Use ref to avoid stale closure
    if (internalRef.current.cloudId === cloudId) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
      setInternal({ ...initialInternalState });
    }
  }, [updateCloudMetadata]);

  const actions = useMemo(
    () => ({
      saveToCloud, saveProjectToCloud, deleteFromCloud, deleteProjectFromCloud,
      setVisibility, setProjectVisibility, loadCloudProject,
      fork, dismissError, initFromProject, syncCloudProjects, unlinkCloudProject,
    }),
    [saveToCloud, saveProjectToCloud, deleteFromCloud, deleteProjectFromCloud,
     setVisibility, setProjectVisibility, loadCloudProject,
     fork, dismissError, initFromProject, syncCloudProjects, unlinkCloudProject],
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
