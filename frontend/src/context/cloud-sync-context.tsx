/**
 * CloudSyncProvider — cloud save/load/fork/delete/sync for the active project.
 *
 * Cloud operations are split across six hooks:
 * - **Active-project ops** (`useActiveProjectCloudOps`): `saveToCloud`,
 *   `deleteFromCloud`, `setVisibility`, `fork`, `loadCloudProject` — operate
 *   on the currently-loaded project using in-memory `appState` via refs.
 * - **By-localId ops** (`useProjectCloudOps`): operates on any project by
 *   `localId`, reading state from localStorage. Used by the My Projects dialog.
 * - **Auto-sync** (`useAutoSync`): debounced dirty→save cycle with status
 *   tracking and `flushSync` for beforeunload.
 * - **Login guard** (`useLoginGuard`): JWT-guarded save/fork with deferred
 *   retry after login.
 * - **Auth transition** (`useAuthTransition`): sign-in retry, cloud project
 *   sync, and sign-out cleanup.
 * - **Dirty tracking** (`useDirtyTracking`): generation-counter `isDirty`.
 *
 * This provider orchestrates state, refs, and delegates to the hooks above.
 * Also owns `initFromProject`, `dismissError`, and `syncCloudProjects`.
 *
 * Both operation hooks delegate shared API logic to `cloud-operations.ts`.
 *
 * Key patterns:
 * - **Ref-synced state**: `internalRef` and `appStateRef` are kept in sync
 *   via useEffect so that useCallback closures always read fresh state
 *   without needing the state in their dependency arrays.
 * - **Mutation lock**: `withMutationLock` prevents concurrent cloud operations.
 */
import { createContext, useContext, useCallback, useState, useMemo, useRef, useEffect, type ReactNode } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import { useProjectStorage, useProjectStorageActions } from './project-storage-context';
import {
  isCloudEnabled,
  listProjects,
  getProject,
} from '../utils/api-client';
import { useAuth, useAuthActions } from './auth-context';
import { buildProjectUrl, createProject, evictProjectData } from '../utils/project-storage';
import { EMPTY_SERIALIZED_STATE } from '../utils/storage';
import { clearCloudUrl, setCloudUrl } from '../utils/cloud-url';
import { useDirtyTracking } from '../hooks/use-dirty-tracking';
import { useActiveProjectCloudOps } from '../hooks/use-active-project-cloud-ops';
import { useProjectCloudOps } from '../hooks/use-project-cloud-ops';
import { useAutoSync, type SyncStatus } from '../hooks/use-auto-sync';
import { useLoginGuard } from '../hooks/use-login-guard';
import { useAuthTransition } from '../hooks/use-auth-transition';
import { computeSyncPatches } from '../utils/cloud-sync';
import { DEFAULT_PROJECT_NAME, type Visibility } from '../types/project';

export type { SyncStatus };

interface CloudSyncState {
  cloudId: string | null;
  isOwner: boolean;
  isDirty: boolean;
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastCloudSavedAt: string | null;
  visibility: Visibility;
  /** True when a cloud operation requires login before proceeding. */
  loginRequired: boolean;
  /** Cloud auto-sync status indicator. */
  syncStatus: SyncStatus;
}

export interface SyncResult {
  updatedCount: number;
  staleCloudIds: string[];
  /** Number of cloud-only projects that were added as local placeholders */
  placeholdersCreated: number;
}

interface CloudSyncActions {
  /** Returns false if the save was dropped because a mutation lock was held. */
  saveToCloud: () => Promise<boolean | undefined>;
  saveProjectToCloud: (localId: string) => Promise<void>;
  deleteFromCloud: () => Promise<void>;
  deleteProjectFromCloud: (cloudId: string) => Promise<void>;
  setVisibility: (v: Visibility) => Promise<void>;
  setProjectVisibility: (localId: string, v: Visibility) => Promise<void>;
  loadCloudProject: (cloudId: string) => Promise<void>;
  fork: () => Promise<void>;
  dismissError: () => void;
  initFromProject: (cloudId: string | null, isOwner: boolean, storage?: 'local' | 'cloud') => void;
  syncCloudProjects: () => Promise<SyncResult>;
  unlinkCloudProject: (localId: string) => void;
  /** Cancel pending cloud operation that was waiting for login. */
  cancelPendingOp: () => void;
  /** Flush any pending cloud sync immediately (best-effort, for beforeunload). */
  flushSync: () => Promise<void>;
}

const CloudSyncStateContext = createContext<CloudSyncState | null>(null);
const CloudSyncActionsContext = createContext<CloudSyncActions | null>(null);

/** Shared with useActiveProjectCloudOps and useProjectCloudOps. */
export interface InternalCloudSyncState {
  cloudId: string | null;
  isOwner: boolean;
  storage: 'local' | 'cloud';
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
  storage: 'local',
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
  const { updateCloudMetadata, createNewProject, refreshProjectList, switchProject } = useProjectStorageActions();
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

  // IMPORTANT: Assigned during render (not in useEffect) so that initFromProject's
  // synchronous ref write in a child effect isn't clobbered by a parent sync effect
  // running later in the same commit — which also breaks under React StrictMode's
  // double-invocation of effects. Do not move to useEffect without verifying the
  // initFromProject race described in the CloudSyncProvider docstring.
  const internalRef = useRef(internal);
  internalRef.current = internal;

  // Ref to avoid stale closures in save/fork callbacks
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // Active-project cloud operations (save, fork, delete, visibility, load)
  const rawActiveOps = useActiveProjectCloudOps({
    internalRef, appStateRef, activeLocalIdRef,
    dataVersionRef, mutationLockRef, needsVersionSyncRef,
    setInternal, updateCloudMetadata, createNewProject,
    getJwt, dispatch, initialInternalState,
  });

  // Login guard: JWT-guarded save/fork with deferred retry
  const loginGuard = useLoginGuard({
    getJwt,
    rawSave: rawActiveOps.saveToCloud,
    rawFork: rawActiveOps.fork,
  });

  // Auto-sync engine (debounced dirty→save)
  const canAutoSync = internal.storage === 'cloud' && internal.isOwner && !!authUser;
  const { syncStatus, flushSync, syncTimerRef } = useAutoSync({
    isDirty,
    internalRef,
    dataVersionRef,
    canAutoSync,
    getJwt,
    saveToCloud: rawActiveOps.saveToCloud,
  });

  const activeOps = useMemo(() => ({
    ...rawActiveOps,
    saveToCloud: loginGuard.saveToCloud,
    fork: loginGuard.fork,
  }), [rawActiveOps, loginGuard.saveToCloud, loginGuard.fork]);

  const initFromProject = useCallback(
    (cloudId: string | null, isOwner: boolean, storage: 'local' | 'cloud' = cloudId && isOwner ? 'cloud' : 'local') => {
      if (cloudId === null) {
        const next = { ...initialInternalState, storage };
        internalRef.current = next;
        setInternal(next);
        clearCloudUrl();
      } else {
        const next = {
          ...internalRef.current,
          cloudId,
          isOwner,
          storage,
          shareUrl: buildProjectUrl(cloudId),
          lastSavedVersion: dataVersionRef.current,
          lastCloudSavedAt: null,
          error: null,
        };
        // Synchronous ref write so the activeLocalId effect's guard
        // (cloudId === internalRef.current.cloudId) sees this in the same commit.
        internalRef.current = next;
        setInternal(next);
      }
    },
    [dataVersionRef],
  );

  const dismissError = useCallback(() => {
    setInternal((prev) => ({ ...prev, error: null }));
  }, []);

  const syncCloudProjects = useCallback(async (): Promise<SyncResult> => {
    const emptyResult: SyncResult = { updatedCount: 0, staleCloudIds: [], placeholdersCreated: 0 };
    if (!isCloudEnabled()) return emptyResult;

    const jwt = getJwt();
    if (!jwt) return emptyResult;
    const response = await listProjects(jwt);

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
        storage: 'cloud',
      });
    }

    return { updatedCount: patches.length, staleCloudIds, placeholdersCreated: cloudOnlyProjects.length };
  }, [updateCloudMetadata, getJwt]);

  // Keep refs up-to-date for the auth-transition and eviction effects
  const syncCloudProjectsRef = useRef<(() => Promise<SyncResult>) | null>(null);
  const flushSyncRef = useRef<(() => Promise<void>) | null>(null);
  syncCloudProjectsRef.current = syncCloudProjects;
  flushSyncRef.current = flushSync;

  // Auth transition: sign-in retry, cloud sync, sign-out cleanup
  const { isSigningOutRef } = useAuthTransition({
    authUser,
    pendingCloudOpRef: loginGuard.pendingCloudOpRef,
    setLoginRequired: loginGuard.setLoginRequired,
    rawSave: rawActiveOps.saveToCloud,
    rawFork: rawActiveOps.fork,
    syncCloudProjectsRef,
    syncTimerRef,
    activeLocalIdRef,
    setInternal,
    initialInternalState,
    refreshProjectList,
    switchProject,
    createNewProject,
  });

  // --- Active project switch: eviction + cloudId tracking ---
  const prevActiveLocalIdRef = useRef<string | null>(null);

  // Derive the active project's cloudId so the effect re-runs when it changes
  // (e.g., after auto-upload sets a cloudId on a previously local-only project).
  const activeCloudId = useMemo(
    () => projects.find(p => p.localId === activeLocalId)?.cloudId ?? null,
    [projects, activeLocalId],
  );

  useEffect(() => {
    if (!activeLocalId) return;

    // Evict previous cloud project's data from localStorage on switch
    const prevLocalId = prevActiveLocalIdRef.current;
    prevActiveLocalIdRef.current = activeLocalId;
    if (prevLocalId && prevLocalId !== activeLocalId) {
      const prevEntry = projectsRef.current.find(p => p.localId === prevLocalId);
      if (prevEntry?.storage === 'cloud' && prevEntry.cloudId) {
        // Flush pending sync first, then evict — only on success and only if
        // the user hasn't navigated back to this project in the meantime.
        // Skip during sign-out to avoid racing with purgeCloudProjects.
        flushSyncRef.current?.().then(() => {
          if (activeLocalIdRef.current === prevLocalId) return; // user navigated back
          if (isSigningOutRef.current) return; // sign-out purge handles cleanup
          evictProjectData(prevLocalId);
        }).catch(() => {
          // Flush failed — keep local data as safety net
        });
      }
    }

    const entry = projectsRef.current.find(p => p.localId === activeLocalId);
    const cloudId = entry?.cloudId ?? null;
    // Skip if cloudId hasn't changed (avoid redundant state updates)
    if (cloudId === internalRef.current.cloudId) return;
    // Clear any pending cloud operation from the previous project
    loginGuard.pendingCloudOpRef.current = null;
    loginGuard.setLoginRequired(false);
    // Use storage === 'cloud' as an optimistic ownership hint — cloud-storage
    // projects were uploaded by this user. The async re-evaluation effect below
    // still confirms via a server round-trip, but this avoids flashing the
    // "shared project" banner on owned projects during the async gap.
    const isOwner = entry?.storage === 'cloud';
    if (cloudId === null) {
      setInternal({ ...initialInternalState });
      clearCloudUrl();
    } else {
      // Signal dirty tracking to capture the version after its next bump,
      // so that re-syncing from a freshly-uploaded project starts clean.
      needsVersionSyncRef.current = true;
      setCloudUrl(cloudId);
      setInternal((prev) => ({
        ...prev,
        cloudId,
        isOwner,
        storage: entry?.storage ?? 'local',
        shareUrl: buildProjectUrl(cloudId),
        lastCloudSavedAt: null,
        error: null,
        visibility: entry?.visibility ?? 'private',
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersionRef is a ref (stable); activeCloudId triggers re-eval when cloudId changes after upload
  }, [activeLocalId, activeCloudId]);

  // Re-evaluate ownership when auth state changes or the active cloud project
  // changes while authenticated. Covers: (1) JWT validated after startup,
  // (2) project switch while already authenticated (e.g., via My Projects).
  useEffect(() => {
    if (!internal.cloudId || internal.isOwner || !authUser) return;

    const jwt = getJwt();
    if (!jwt) return;

    let cancelled = false;
    getProject(internal.cloudId, jwt)
      .then((res) => {
        // Verify user is still authenticated when response arrives (SEC-M3)
        if (!cancelled && res.isOwner && getJwt()) {
          setInternal((prev) => prev.cloudId === internal.cloudId ? { ...prev, isOwner: true } : prev);
        }
      })
      .catch(() => { /* best-effort; ownership stays false */ });
    return () => { cancelled = true; };
  }, [authUser, getJwt, internal.cloudId, internal.isOwner]);

  // By-localId cloud operations (used by My Projects dialog)
  const projectOps = useProjectCloudOps({
    updateCloudMetadata,
    projectsRef,
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
      ...activeOps,
      dismissError, initFromProject, syncCloudProjects,
      cancelPendingOp: loginGuard.cancelPendingOp,
      flushSync,
      ...projectOps,
    }),
    [activeOps, dismissError, initFromProject, syncCloudProjects, loginGuard.cancelPendingOp, flushSync, projectOps],
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
      loginRequired: loginGuard.loginRequired,
      syncStatus,
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
      loginGuard.loginRequired,
      syncStatus,
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
