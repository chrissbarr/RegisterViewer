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
  getProject,
} from '../utils/api-client';
import { useAuth, useAuthActions } from './auth-context';
import { buildProjectUrl, createProject } from '../utils/project-storage';
import { EMPTY_SERIALIZED_STATE } from '../utils/storage';
import { clearCloudUrl } from '../utils/cloud-utils';
import { useDirtyTracking } from '../hooks/use-dirty-tracking';
import { useActiveProjectCloudOps } from '../hooks/use-active-project-cloud-ops';
import { useProjectCloudOps } from '../hooks/use-project-cloud-ops';
import { useAutoSync, type SyncStatus } from '../hooks/use-auto-sync';
import { useLoginGuard } from '../hooks/use-login-guard';
import { useAuthTransition } from '../hooks/use-auth-transition';
import { useProjectSwitchInit } from '../hooks/use-project-switch-init';
import { syncCloudProjectsFromServer } from '../utils/cloud-sync';
import type { Visibility } from '../types/project';
import type { AppState } from '../types/register';
import { initialInternalState, type CloudSyncCore, type InternalCloudSyncState, type SyncResult } from '../types/cloud-sync';

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

interface CloudSyncActions {
  /**
   * Save the active project to the cloud.
   *
   * Returns:
   * - `true` — saved successfully (or cloud disabled)
   * - `false` — mutation lock held by another operation; try again later
   * - `undefined` — no JWT; operation deferred to login dialog (auto-retried on sign-in)
   */
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
 *
 * PERF-1: Decomposed hooks may trigger 2-4 extra renders per project switch
 * via cascading setInternal calls. This is inherent to the hook-based architecture
 * and is not user-visible (no layout thrashing). If profiling reveals jank,
 * consolidate to useReducer. See .full-review/05-final-report.md.
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
  internalRef.current = internal; // eslint-disable-line react-hooks/refs -- intentional render-time sync; see docstring above

  // Shared refs passed to all cloud sync hooks (AR-1: reduces per-hook param count).
  // All items are stable across renders (refs, useState setter, module-level const).
  const core: CloudSyncCore = useMemo(
    () => ({ internalRef, activeLocalIdRef, setInternal }),
    [],
  );

  // Ref to avoid stale closures in save/fork callbacks.
  // Synced via useEffect (not render-time assignment) because appStateRef doesn't
  // need same-commit synchronous visibility — callbacks that read it run async.
  // Compare: internalRef uses render-time sync for initFromProject's same-commit
  // guard; lastStableStateRef uses render-time sync for snapshot consistency.
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // Snapshot of the current project's latest app state, updated during render.
  // When activeLocalId changes in the same commit as LOAD_STATE (both fired
  // by switchProject), appStateRef already holds the *new* project's state by
  // the time the project-switch effect runs. This ref preserves the *previous*
  // project's last state so flush-before-evict saves the correct data.
  const lastStableStateRef = useRef<{ localId: string | null; state: AppState }>({
    localId: activeLocalId,
    state: appState,
  });
  if (activeLocalId === lastStableStateRef.current.localId) { // eslint-disable-line react-hooks/refs -- intentional render-time read; see comment above
    // Still on the same project — keep the snapshot fresh
    lastStableStateRef.current.state = appState; // eslint-disable-line react-hooks/refs
  } else if (lastStableStateRef.current.localId === null) { // eslint-disable-line react-hooks/refs
    // Transitioning from unsaved (null) to saved — adopt the new project's
    // localId so the eviction effect can match it later. Without this, the
    // ref stays stuck at localId=null after saveCurrentProject() changes
    // activeLocalId from null to a real id, causing flush-before-evict to
    // fail to find the departing project's state snapshot.
    lastStableStateRef.current = { localId: activeLocalId, state: appState }; // eslint-disable-line react-hooks/refs
  }
  // When activeLocalId changes between two truthy ids (real project switch),
  // we intentionally do NOT update — preserving the previous project's state
  // for the eviction effect to flush before evicting.

  // Active-project cloud operations (save, fork, delete, visibility, load)
  const rawActiveOps = useActiveProjectCloudOps({
    core, appStateRef,
    dataVersionRef, mutationLockRef, needsVersionSyncRef,
    updateCloudMetadata, createNewProject, getJwt, dispatch,
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

  /**
   * Initialize cloud state for a newly-switched project.
   *
   * @param cloudId - The project's cloud ID, or null for local-only projects.
   * @param isOwner - Whether the current user owns this cloud project.
   * @param storage - Storage type; defaults to 'cloud' if cloudId is present and owned,
   *                  'local' otherwise. This default ensures owned cloud projects are
   *                  automatically set up for auto-sync.
   */
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

    // TODO(CQ-4): staleCloudIds are computed but not acted on — server-deleted
    // projects remain in the local manifest. A future enhancement should unlink
    // these entries via updateCloudMetadata(localId, CLEARED_CLOUD_METADATA).
    return syncCloudProjectsFromServer(jwt, projectsRef.current, {
      updateCloudMetadata,
      // AR-6: Uses raw `createProject` utility (not the context action `createNewProject`)
      // because this callback runs during async sync, not during a React render.
      // The context action would trigger additional side effects (project switching)
      // that are undesirable for background placeholder creation.
      createPlaceholder: (data) => {
        try {
          createProject(EMPTY_SERIALIZED_STATE, data.title, {
            cloudId: data.cloudId,
            visibility: data.visibility,
            cloudSavedAt: data.cloudSavedAt,
            storage: 'cloud',
          });
        } catch (err) {
          console.warn('[cloud-sync] Failed to create placeholder for cloud project', data.cloudId, err);
        }
      },
    });
  }, [updateCloudMetadata, getJwt]);

  // Callback refs: nullable because the callbacks reference state/hooks defined below.
  // Direct assignment in render (not useEffect) ensures they're fresh by the time
  // effects in child hooks read them. The `| null` type forces consumers to use
  // optional chaining, preventing calls before initialization.
  const syncCloudProjectsRef = useRef<(() => Promise<SyncResult>) | null>(null);
  const flushSyncRef = useRef<((stateOverride?: AppState) => Promise<void>) | null>(null);
  syncCloudProjectsRef.current = syncCloudProjects; // eslint-disable-line react-hooks/refs -- render-time sync for stable callback refs
  flushSyncRef.current = flushSync; // eslint-disable-line react-hooks/refs

  // Auth transition: sign-in retry, cloud sync, sign-out cleanup
  const { isSigningOutRef } = useAuthTransition({
    core, authUser,
    pendingCloudOpRef: loginGuard.pendingCloudOpRef,
    setLoginRequired: loginGuard.setLoginRequired,
    rawSave: rawActiveOps.saveToCloud,
    rawFork: rawActiveOps.fork,
    syncCloudProjectsRef, syncTimerRef,
    refreshProjectList, switchProject, createNewProject,
  });

  // --- Active project switch: cloud state init + best-effort save ---
  useProjectSwitchInit({
    core, activeLocalId, appState, projects,
    projectsRef, needsVersionSyncRef,
    lastStableStateRef, flushSyncRef, syncTimerRef, isSigningOutRef,
    cancelPendingOp: loginGuard.cancelPendingOp,
  });

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
    core, updateCloudMetadata, projectsRef,
    mutationLockRef, getJwt,
    activeProjectSave: rawActiveOps.saveToCloud,
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
