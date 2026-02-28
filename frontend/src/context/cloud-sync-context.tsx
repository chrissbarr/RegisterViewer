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
  getProject,
} from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import {
  getOrCreateOwnerToken,
  hashOwnerToken,
  checkOwnership,
} from '../utils/owner-token';
import { useAuth, useAuthActions } from './auth-context';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { buildProjectUrl, createProject } from '../utils/project-storage';
import { EMPTY_SERIALIZED_STATE } from '../utils/storage';
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
  /** Number of cloud-only projects that were added as local placeholders */
  placeholdersCreated: number;
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

interface ServerProject {
  id: string;
  title: string | null;
  visibility: Visibility;
  updatedAt: string;
}

interface SyncPatchResult {
  patches: SyncPatch[];
  staleCloudIds: string[];
  /** Server projects that have no matching local entry */
  cloudOnlyProjects: ServerProject[];
}

function computeSyncPatches(
  projects: ProjectListEntry[],
  serverProjects: ReadonlyArray<ServerProject>,
): SyncPatchResult {
  const serverMap = new Map(serverProjects.map(p => [p.id, p]));
  const patches: SyncPatch[] = [];
  const staleCloudIds: string[] = [];
  const localCloudIds = new Set(projects.filter(p => p.cloudId).map(p => p.cloudId!));

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

  // Find server projects with no local counterpart
  const cloudOnlyProjects = serverProjects.filter(sp => !localCloudIds.has(sp.id));

  return { patches, staleCloudIds, cloudOnlyProjects };
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
 * stable across renders. `initFromProject` additionally updates
 * `internalRef` synchronously (before `setInternal`) so that the
 * `activeLocalId` effect's guard sees the cloudId immediately and
 * skips, preventing a race where both effects fire in the same commit.
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
  const { user: authUser } = useAuth();
  const { getJwt } = useAuthActions();

  const [internal, setInternal] = useState<InternalCloudSyncState>(initialInternalState);

  const activeLocalIdRef = useRef(activeLocalId);
  useEffect(() => {
    activeLocalIdRef.current = activeLocalId;
  }, [activeLocalId]);

  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // Dirty tracking (generation-counter pattern)
  const { isDirty, dataVersionRef, needsVersionSyncRef, mutationLockRef } = useDirtyTracking(
    appState,
    internal,
    setInternal,
  );

  // Sync cloud state when active project changes (handles project switch)
  const internalRef = useRef(internal);
  useEffect(() => {
    internalRef.current = internal;
  }, [internal]);

  useEffect(() => {
    if (!activeLocalId) return;
    const entry = projectsRef.current.find(p => p.localId === activeLocalId);
    const cloudId = entry?.cloudId ?? null;
    // Skip if cloudId hasn't changed (avoid redundant state updates)
    if (cloudId === internalRef.current.cloudId) return;
    // Local ownerToken check, OR if the user has a JWT, trust that manifest
    // projects with a cloudId are owned (they come from local save or sync,
    // never from opening someone else's shared link).
    const isOwner = cloudId ? (checkOwnership(cloudId) || !!getJwt()) : false;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersionRef is a ref (stable), getJwt is stable (useCallback with [])
  }, [activeLocalId]);

  // Ref to avoid stale closures in save/fork callbacks
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

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

  // Re-evaluate ownership when auth state changes or the active cloud project
  // changes while authenticated. Covers: (1) JWT validated after startup,
  // (2) project switch while already authenticated (e.g., via My Projects).
  useEffect(() => {
    if (!internal.cloudId || internal.isOwner || !authUser) return;

    const jwt = getJwt();
    if (!jwt) return;

    let cancelled = false;
    getProject(internal.cloudId, { tokenHash: '', jwt })
      .then((res) => {
        if (!cancelled && res.isOwner) {
          setInternal((prev) => prev.cloudId === internal.cloudId ? { ...prev, isOwner: true } : prev);
        }
      })
      .catch(() => { /* best-effort; ownership stays false */ });
    return () => { cancelled = true; };
  }, [authUser, getJwt, internal.cloudId, internal.isOwner]);

  const saveToCloud = useCallback(async () => {
    if (!isCloudEnabled()) return;
    await withMutationLock(mutationLockRef, async () => {
      try {
        const { cloudId, isOwner } = internalRef.current;
        const existingCloudId = (cloudId && isOwner) ? cloudId : null;

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const jsonPayload = exportToObject(appStateRef.current);
        const jwt = getJwt();
        const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, jwt);

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
  }, [updateCloudMetadata, applyCreatedResult, mutationLockRef, dataVersionRef, getJwt]);

  const fork = useCallback(async () => {
    if (!isCloudEnabled()) return;
    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
      try {
        const jsonPayload = exportToObject(appStateRef.current);
        const jwt = getJwt();
        const result = await saveProjectToCloudImpl(jsonPayload, null, jwt);
        if (result.kind !== 'created') throw new Error('Failed to save copy.');
        applyCreatedResult(result);
      } catch (err) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: friendlyErrorMessage(err, 'Failed to save copy.') }));
      }
    });
  }, [applyCreatedResult, mutationLockRef, getJwt]);

  const deleteFromCloud = useCallback(async () => {
    const { cloudId } = internalRef.current;
    if (!cloudId) return;
    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'deleting', error: null }));
      try {
        const jwt = getJwt();
        await deleteProjectFromCloudImpl(cloudId, jwt);

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
  }, [updateCloudMetadata, mutationLockRef, getJwt]);

  const setVisibility = useCallback(async (v: Visibility) => {
    const { cloudId, isOwner, visibility: previousVisibility } = internalRef.current;
    setInternal((prev) => ({ ...prev, visibility: v }));

    if (cloudId && isOwner) {
      try {
        const jwt = getJwt();
        await patchVisibilityImpl(cloudId, v, jwt);

        const currentLocalId = activeLocalIdRef.current;
        if (currentLocalId) {
          updateCloudMetadata(currentLocalId, { visibility: v });
        }
      } catch (err) {
        // Revert on failure and show error
        setInternal((prev) => ({
          ...prev,
          visibility: previousVisibility,
          error: friendlyErrorMessage(err, 'Failed to update visibility.'),
        }));
      }
    }
  }, [updateCloudMetadata, getJwt]);

  const initFromProject = useCallback(
    (cloudId: string | null, isOwner: boolean) => {
      if (cloudId === null) {
        const next = { ...initialInternalState };
        internalRef.current = next;
        setInternal(next);
        clearCloudUrl();
      } else {
        const next = {
          ...internalRef.current,
          cloudId,
          isOwner,
          shareUrl: buildProjectUrl(cloudId),
          lastSavedVersion: dataVersionRef.current,
          lastCloudSavedAt: null,
          error: null,
        };
        // Synchronously update ref so the activeLocalId effect's guard
        // (cloudId === internalRef.current.cloudId) sees this immediately,
        // preventing it from overwriting isOwner with a stale local check.
        internalRef.current = next;
        setInternal(next);
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
        const jwt = getJwt();
        const importResult = await fetchAndParseCloudProject(cloudId, jwt ? { tokenHash: '', jwt } : undefined);

        dispatch({
          type: 'IMPORT_STATE',
          registers: importResult.registers,
          values: importResult.values,
          project: importResult.project,
          addressUnitBits: importResult.addressUnitBits,
        });

        // Use server-reported isOwner (accounts for JWT auth cross-device),
        // fall back to local ownerToken check when no auth was sent.
        const isOwner = importResult.isOwner || checkOwnership(cloudId);
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
    [dispatch, needsVersionSyncRef, getJwt],
  );

  const syncCloudProjects = useCallback(async (): Promise<SyncResult> => {
    if (!isCloudEnabled()) return { updatedCount: 0, staleCloudIds: [], placeholdersCreated: 0 };

    // Prefer JWT for listing (shows all user-linked projects cross-device),
    // fall back to token hash for anonymous users.
    const jwt = getJwt();
    const authToken = jwt ?? await hashOwnerToken(getOrCreateOwnerToken());
    const response = await listProjects(authToken);

    const { patches, staleCloudIds, cloudOnlyProjects } = computeSyncPatches(projectsRef.current, response.projects);

    for (const { localId, ...updates } of patches) {
      updateCloudMetadata(localId, updates);
    }

    // Create lightweight local placeholders for cloud-only projects so they
    // appear in the project list with full cloud actions (share, visibility, delete).
    // The actual project data is fetched lazily when the user opens the project.
    for (const sp of cloudOnlyProjects) {
      createProject(EMPTY_SERIALIZED_STATE, sp.title ?? DEFAULT_PROJECT_NAME, {
        cloudId: sp.id,
        visibility: sp.visibility,
        cloudSavedAt: sp.updatedAt,
      });
    }

    return { updatedCount: patches.length, staleCloudIds, placeholdersCreated: cloudOnlyProjects.length };
  }, [updateCloudMetadata, getJwt]);

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
    getJwt,
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
