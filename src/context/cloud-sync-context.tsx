/**
 * CloudSyncProvider — cloud save/load/fork/delete/sync for the active project.
 *
 * Cloud operations have two paths:
 * - **Active-project path** (this provider): operates on the currently-loaded
 *   project using in-memory `appState` via refs. Exposes `saveToCloud`,
 *   `deleteFromCloud`, `setVisibility`, `fork`, `loadCloudProject`, and
 *   `syncCloudProjects`.
 * - **By-localId path** (`useProjectCloudOps` hook): operates on any project
 *   by `localId`, reading state from localStorage. Used by the My Projects
 *   dialog for bulk operations on non-active projects.
 *
 * Both paths delegate shared logic to `cloud-operations.ts` to avoid divergence.
 *
 * Key patterns:
 * - **Generation-counter dirty tracking** (`useDirtyTracking`): a ref-based
 *   version counter increments on data changes; `isDirty` is derived by
 *   comparing current version vs `lastSavedVersion`.
 * - **Ref-synced state**: `internalRef` and `appStateRef` are kept in sync
 *   via useEffect so that useCallback closures always read fresh state
 *   without needing the state in their dependency arrays.
 * - **Mutation lock**: `withMutationLock` prevents concurrent cloud operations.
 */
import { createContext, useContext, useCallback, useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import { useProjectStorage, useProjectStorageActions } from './project-storage-context';
import { exportToObject, serializeState } from '../utils/storage';
import {
  isCloudEnabled,
  ApiError,
  listProjects,
} from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import {
  getOrCreateOwnerToken,
  hashOwnerToken,
  checkOwnership,
} from '../utils/owner-token';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { buildProjectUrl } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock } from '../utils/cloud-url';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import { useDirtyTracking } from '../hooks/use-dirty-tracking';
import { useProjectCloudOps } from '../hooks/use-project-cloud-ops';
import { DEFAULT_PROJECT_NAME, type ProjectListEntry, type Visibility } from '../types/project';

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

interface SyncPatch {
  localId: string;
  cloudSavedAt?: string;
  visibility?: Visibility;
}

function computeSyncPatches(
  projects: ProjectListEntry[],
  serverProjects: ReadonlyArray<{ id: string; visibility: Visibility; updatedAt: string }>,
): { patches: SyncPatch[]; staleCloudIds: string[] } {
  const serverMap = new Map(serverProjects.map(p => [p.id, p]));
  const patches: SyncPatch[] = [];
  const staleCloudIds: string[] = [];

  for (const entry of projects) {
    if (!entry.cloudId) continue;

    const serverProject = serverMap.get(entry.cloudId);
    if (serverProject) {
      const patch: SyncPatch = { localId: entry.localId };
      let hasUpdate = false;

      const serverTime = new Date(serverProject.updatedAt).getTime();
      const localCloudTime = entry.cloudSavedAt ? new Date(entry.cloudSavedAt).getTime() : 0;
      if (serverTime > localCloudTime) {
        patch.cloudSavedAt = serverProject.updatedAt;
        hasUpdate = true;
      }
      if (serverProject.visibility !== entry.visibility) {
        patch.visibility = serverProject.visibility;
        hasUpdate = true;
      }
      if (hasUpdate) patches.push(patch);
    } else {
      staleCloudIds.push(entry.cloudId);
    }
  }

  return { patches, staleCloudIds };
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

/**
 * Manages cloud synchronization state for the active project.
 *
 * Architecture: split into two contexts (state + actions) to avoid
 * re-rendering consumers that only need actions. Cloud state tracks
 * the active project's cloudId, ownership, dirty status (generation-
 * counter pattern via useDirtyTracking), and operation status.
 *
 * Refs (appStateRef, internalRef, activeLocalIdRef) are used to give
 * stable callbacks access to latest values without appearing in
 * dependency arrays — this keeps the actions object referentially
 * stable across renders.
 *
 * By-localId operations (saveProjectToCloud, deleteProjectFromCloud,
 * setProjectVisibility, unlinkCloudProject) are delegated to
 * useProjectCloudOps for use by the My Projects dialog.
 */
export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const appState = useAppState();
  const dispatch = useAppDispatch();
  const { activeLocalId, projects } = useProjectStorage();
  const { updateCloudMetadata, createNewProject } = useProjectStorageActions();

  const [internal, setInternal] = useState<InternalCloudSyncState>(initialInternalState);

  // Track activeLocalId and projects in refs for use in async callbacks
  const activeLocalIdRef = useRef(activeLocalId);
  useEffect(() => {
    activeLocalIdRef.current = activeLocalId;
  }, [activeLocalId]);

  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  });

  // Dirty tracking (generation-counter pattern)
  const { isDirty, dataVersionRef, needsVersionSyncRef, mutationLockRef } = useDirtyTracking(
    appState,
    internal,
    setInternal,
  );

  // Sync cloud state when active project changes (handles project switch)
  const internalRef = useRef(internal);
  // No dependency array: intentionally runs every render so callbacks
  // reading internalRef.current always see the latest state without
  // needing `internal` in their dependency arrays (avoids re-creating callbacks).
  useEffect(() => {
    internalRef.current = internal;
  });

  useEffect(() => {
    if (!activeLocalId) return;
    const entry = projectsRef.current.find(p => p.localId === activeLocalId);
    const cloudId = entry?.cloudId ?? null;
    // Skip if cloudId hasn't changed (avoid redundant state updates)
    if (cloudId === internalRef.current.cloudId) return;
    const isOwner = cloudId ? checkOwnership(cloudId) : false;
    if (cloudId === null) {
      setInternal({ ...initialInternalState });
      clearCloudUrl();
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
  }, [activeLocalId, dataVersionRef]);

  // Ref to avoid stale closures in save/fork callbacks
  const appStateRef = useRef(appState);
  // No dependency array: intentionally runs every render so callbacks
  // reading appStateRef.current always see the latest state without
  // needing `appState` in their dependency arrays (avoids re-creating callbacks).
  useEffect(() => {
    appStateRef.current = appState;
  });

  const applyCreatedResult = useCallback((result: { cloudId: string; timestamp: string; ownerToken: string }) => {
    let currentLocalId = activeLocalIdRef.current;

    // When forking a shared project, no local project exists yet — create one
    if (!currentLocalId) {
      const serialized = serializeState(appStateRef.current);
      const name = appStateRef.current.project?.title ?? DEFAULT_PROJECT_NAME;
      currentLocalId = createNewProject(name, serialized);
    }

    updateCloudMetadata(currentLocalId, {
      cloudId: result.cloudId,
      cloudSavedAt: result.timestamp,
      ownerToken: result.ownerToken,
    });

    const shareUrl = buildProjectUrl(result.cloudId);
    setCloudUrl(result.cloudId);

    setInternal((prev) => ({
      ...prev,
      cloudId: result.cloudId,
      isOwner: true,
      status: 'idle',
      shareUrl,
      lastCloudSavedAt: result.timestamp,
      lastSavedVersion: dataVersionRef.current,
    }));
  }, [updateCloudMetadata, createNewProject, dataVersionRef]);

  const saveToCloud = useCallback(async () => {
    if (!isCloudEnabled()) return;
    await withMutationLock(mutationLockRef, async () => {
      try {
        const { cloudId, isOwner } = internalRef.current;
        const existingCloudId = (cloudId && isOwner) ? cloudId : null;

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const jsonPayload = exportToObject(appStateRef.current);
        const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId);

        if (result.kind === 'not-found') {
          const currentLocalId = activeLocalIdRef.current;
          if (currentLocalId) {
            updateCloudMetadata(currentLocalId, CLEARED_CLOUD_METADATA);
          }
          clearCloudUrl();
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

        if (result.kind === 'created') {
          applyCreatedResult(result);
        } else {
          const currentLocalId = activeLocalIdRef.current;
          if (currentLocalId) {
            updateCloudMetadata(currentLocalId, { cloudSavedAt: result.timestamp });
          }
          setInternal((prev) => ({
            ...prev,
            status: 'idle',
            lastCloudSavedAt: result.timestamp,
            lastSavedVersion: dataVersionRef.current,
          }));
        }
      } catch (err) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: friendlyErrorMessage(err, 'Failed to save project.') }));
      }
    });
  }, [updateCloudMetadata, applyCreatedResult, mutationLockRef, dataVersionRef]);

  const fork = useCallback(async () => {
    if (!isCloudEnabled()) return;
    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
      try {
        const jsonPayload = exportToObject(appStateRef.current);
        const result = await saveProjectToCloudImpl(jsonPayload, null);
        if (result.kind !== 'created') throw new Error('Failed to save copy.');
        applyCreatedResult(result);
      } catch (err) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: friendlyErrorMessage(err, 'Failed to save copy.') }));
      }
    });
  }, [applyCreatedResult, mutationLockRef]);

  const deleteFromCloud = useCallback(async () => {
    const { cloudId } = internalRef.current;
    if (!cloudId) return;
    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'deleting', error: null }));
      try {
        await deleteProjectFromCloudImpl(cloudId);

        const currentLocalId = activeLocalIdRef.current;
        if (currentLocalId) {
          updateCloudMetadata(currentLocalId, CLEARED_CLOUD_METADATA);
        }

        clearCloudUrl();
        setInternal({ ...initialInternalState });
      } catch (err) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: friendlyErrorMessage(err, 'Failed to delete project.') }));
      }
    });
  }, [updateCloudMetadata, mutationLockRef]);

  const setVisibility = useCallback(async (v: Visibility) => {
    const { cloudId, isOwner, visibility: previousVisibility } = internalRef.current;
    setInternal((prev) => ({ ...prev, visibility: v }));

    if (cloudId && isOwner) {
      try {
        await patchVisibilityImpl(cloudId, v);

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

  const initFromProject = useCallback(
    (cloudId: string | null, isOwner: boolean) => {
      if (cloudId === null) {
        setInternal({ ...initialInternalState });
        clearCloudUrl();
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
    [dataVersionRef],
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
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          error: friendlyErrorMessage(err, 'Failed to load project.'),
        }));
      }
    },
    [dispatch, needsVersionSyncRef],
  );

  const syncCloudProjects = useCallback(async (): Promise<SyncResult> => {
    if (!isCloudEnabled()) return { updatedCount: 0, staleCloudIds: [] };

    const ownerToken = getOrCreateOwnerToken();
    const tokenHash = await hashOwnerToken(ownerToken);
    const response = await listProjects(tokenHash);

    const { patches, staleCloudIds } = computeSyncPatches(projectsRef.current, response.projects);

    for (const { localId, ...updates } of patches) {
      updateCloudMetadata(localId, updates);
    }

    return { updatedCount: patches.length, staleCloudIds };
  }, [updateCloudMetadata]);

  // By-localId cloud operations (used by My Projects dialog)
  const projectOps = useProjectCloudOps({
    updateCloudMetadata,
    projects,
    activeLocalIdRef,
    dataVersionRef,
    mutationLockRef,
    internalRef,
    setInternal,
    initialInternalState,
  });

  const actions = useMemo(
    () => ({
      saveToCloud, deleteFromCloud, setVisibility, loadCloudProject,
      fork, dismissError, initFromProject, syncCloudProjects,
      ...projectOps,
    }),
    [saveToCloud, deleteFromCloud, setVisibility, loadCloudProject,
     fork, dismissError, initFromProject, syncCloudProjects, projectOps],
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

export function useCloudSync(): CloudSyncState {
  const ctx = useContext(CloudSyncStateContext);
  if (!ctx) throw new Error('useCloudSync must be used within CloudSyncProvider');
  return ctx;
}

export function useCloudSyncActions(): CloudSyncActions {
  const ctx = useContext(CloudSyncActionsContext);
  if (!ctx) throw new Error('useCloudSyncActions must be used within CloudSyncProvider');
  return ctx;
}
