/**
 * CloudSyncProvider — cloud save/load/fork/delete/sync for the active project.
 *
 * Cloud operations are split across four hooks:
 * - **Active-project ops** (`useActiveProjectCloudOps`): `saveToCloud`,
 *   `deleteFromCloud`, `setVisibility`, `fork`, `loadCloudProject` — operate
 *   on the currently-loaded project using in-memory `appState` via refs.
 *   Also includes inline JWT guard (login state).
 * - **By-localId ops** (`useProjectCloudOps`): operates on any project by
 *   `localId`, reading state from localStorage. Used by the My Projects dialog.
 * - **Cloud sync engine** (`useCloudSyncEngine`): merged dirty tracking
 *   (generation-counter `isDirty`) and auto-sync (debounced dirty→save cycle
 *   with status tracking and `flushCloudSync` for beforeunload).
 * - **Auth transition** (`useAuthTransition`): sign-in retry, cloud project
 *   sync, and sign-out cleanup.
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
import { createContext, useContext, useCallback, useReducer, useMemo, useRef, useEffect, type ReactNode, type MutableRefObject, type Dispatch } from 'react';
import { useAppState, useAppDispatch } from './app-context';
import type { AppState } from '../types/register';
import { useProjectStorage, useProjectStorageActions } from './project-storage-context';
import {
  isCloudEnabled,
  getProject,
} from '../utils/api-client';
import { useAuth, useAuthActions } from './auth-context';
import {
  buildProjectUrl,
  createProject,
  deleteProject,
  evictProjectData,
  hasLocalData,
  loadManifest,
  patchProjectState,
  toProjectListEntry,
} from '../utils/project-storage';
import { EMPTY_SERIALIZED_STATE, serializeState } from '../utils/storage';
import { CLEARED_CLOUD_METADATA, clearCloudUrl, withMutationLock } from '../utils/cloud-utils';
import { useActiveProjectCloudOps } from '../hooks/use-active-project-cloud-ops';
import { useProjectCloudOps } from '../hooks/use-project-cloud-ops';
import { useCloudSyncEngine, type SyncStatus } from '../hooks/use-cloud-sync-engine';
import { useAuthTransition } from '../hooks/use-auth-transition';
import { useProjectSwitchInit } from '../hooks/use-project-switch-init';
import { syncCloudProjectsFromServer, positiveVersion, normalizeServerVersion } from '../utils/cloud-sync';
import { cloudSyncReducer, cloudStateForEntry, selectWasDirty, type CloudSyncAction } from '../utils/cloud-sync-reducer';
import { checkAndPullFreshVersion, type FreshnessCheckContext } from '../hooks/use-cloud-freshness';
import { isOwnedCloudEntry } from '../utils/project-identity';
import type { Visibility } from '../types/project';
import { initialInternalState, type CloudInit, type CloudSyncCore, type InternalCloudSyncState, type SaveOutcome, type SyncResult } from '../types/cloud-sync';

export type { SyncStatus };

function uniqueProtectedLocalIds(ids: readonly (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => !!id)));
}

/**
 * Ref/callback bag shared by the extracted stale-reconcile and placeholder
 * `*Impl` functions. These mirror the `cloud-operations.ts` `*Impl` pattern:
 * the side-effecting logic lives in a named function that closes over nothing
 * itself; everything it touches is threaded in via this bag. Refs stay raw
 * (reducer/actions conversion is a later slice).
 */
interface SyncReconcileDeps {
  internalRef: MutableRefObject<InternalCloudSyncState>;
  activeLocalIdRef: MutableRefObject<string | null>;
  appStateRef: MutableRefObject<AppState>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  mutationLockRef: MutableRefObject<boolean>;
  dispatchInternal: Dispatch<CloudSyncAction>;
  updateCloudMetadata: ReturnType<typeof useProjectStorageActions>['updateCloudMetadata'];
}

/**
 * Reconcile a single stale (server-deleted) owned cloud project: keep the local
 * data, clear the cloud metadata, and — when it's the active project — reset
 * active cloud state. Extracted from the inline `syncCloudProjects` closure
 * (behavior identical). Returns the same boolean semantics that
 * `syncCloudProjectsFromServer` consumes (true = reconciled / nothing to do,
 * false = could not reconcile this round).
 */
async function reconcileStaleCloudProjectImpl(
  deps: SyncReconcileDeps,
  { localId, cloudId, cloudSavedAt, serverVersion }: {
    localId: string;
    cloudId: string;
    cloudSavedAt: string | null;
    serverVersion: number | null;
  },
  options: { protectedLocalIds: readonly string[] },
): Promise<boolean> {
  const {
    internalRef, activeLocalIdRef, appStateRef, syncTimerRef,
    mutationLockRef, dispatchInternal, updateCloudMetadata,
  } = deps;

  const lockResult = await withMutationLock(mutationLockRef, async () => {
    const protectedLocalIds = uniqueProtectedLocalIds([
      activeLocalIdRef.current,
      ...options.protectedLocalIds,
    ]);
    const latestEntry = loadManifest().projects.find(p => p.localId === localId);
    if (!latestEntry) return true;
    if (!isOwnedCloudEntry(latestEntry) || latestEntry.cloudId !== cloudId) return true;
    if (
      (latestEntry.cloudSavedAt ?? null) !== cloudSavedAt ||
      (latestEntry.serverVersion ?? null) !== serverVersion
    ) {
      return false;
    }

    const isActiveLocalProject = activeLocalIdRef.current === localId;
    const isActiveCloudProject = isActiveLocalProject && internalRef.current.cloudId === cloudId;

    if (!isActiveLocalProject && !hasLocalData(localId)) {
      deleteProject(localId);
      return true;
    }

    if (isActiveLocalProject) {
      const stateWrite = patchProjectState(localId, serializeState(appStateRef.current), {
        protectedLocalIds,
      });
      if (!stateWrite.ok) {
        dispatchInternal({
          type: 'SET_ERROR',
          ifCloudId: cloudId,
          error: 'Cloud project was deleted on the server, but local data could not be saved before unlinking.',
        });
        return false;
      }
    }

    const metadataWrite = updateCloudMetadata(localId, CLEARED_CLOUD_METADATA, {
      preserveLocalSavedAt: true,
      protectedLocalIds,
    });
    if (!metadataWrite.ok) {
      if (isActiveCloudProject) {
        dispatchInternal({
          type: 'SET_ERROR',
          ifCloudId: cloudId,
          error: 'Cloud project was deleted on the server, but local metadata could not be updated.',
        });
      }
      return false;
    }

    if (isActiveCloudProject) {
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }
      const error = 'Cloud project was deleted on the server. Local copy kept.';
      const next = { ...initialInternalState, error };
      // Synchronous ref write preceding the dispatch (same-commit ref visibility).
      internalRef.current = next;
      dispatchInternal({ type: 'RESET_WITH_ERROR', error });
      clearCloudUrl();
    }

    return true;
  });

  if (!lockResult.executed) {
    if (activeLocalIdRef.current === localId && internalRef.current.cloudId === cloudId) {
      dispatchInternal({
        type: 'SET_ERROR',
        ifCloudId: cloudId,
        error: 'Cloud project was deleted on the server, but another cloud operation is in progress.',
      });
    }
    return false;
  }
  return lockResult.result;
}

/**
 * Create a manifest-only local placeholder for a server-side cloud project that
 * has no local counterpart. Extracted from the inline `syncCloudProjects`
 * closure (behavior identical).
 *
 * AR-6: Uses the raw `createProject` utility (not the context action
 * `createNewProject`) because this runs during async sync, not during a React
 * render. The context action would trigger additional side effects (project
 * switching) that are undesirable for background placeholder creation.
 *
 * Returns `false` when a placeholder already exists (active project or an owned
 * manifest entry already references this cloudId) or creation failed.
 */
function createPlaceholderImpl(
  deps: Pick<SyncReconcileDeps, 'internalRef' | 'activeLocalIdRef'>,
  data: {
    title: string;
    cloudId: string;
    visibility: Visibility;
    cloudSavedAt: string;
    serverVersion: number;
  },
  options?: { protectedLocalIds: readonly string[] },
): boolean {
  const { internalRef, activeLocalIdRef } = deps;
  const latestManifest = loadManifest();
  if (
    internalRef.current.cloudId === data.cloudId ||
    latestManifest.projects.filter(isOwnedCloudEntry).some(p => p.cloudId === data.cloudId)
  ) {
    return false;
  }
  try {
    const localId = createProject(EMPTY_SERIALIZED_STATE, data.title, {
      cloudId: data.cloudId,
      visibility: data.visibility,
      cloudSavedAt: data.cloudSavedAt,
      serverVersion: data.serverVersion,
      hasUnsyncedChanges: false,
      storage: 'cloud',
    }, {
      protectedLocalIds: uniqueProtectedLocalIds([
        activeLocalIdRef.current,
        ...(options?.protectedLocalIds ?? []),
      ]),
    });
    evictProjectData(localId);
    return true;
  } catch (err) {
    console.warn('[cloud-sync] Failed to create placeholder for cloud project', data.cloudId, err);
    return false;
  }
}

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
  /** Non-null when a save conflict was detected (server version mismatch). */
  conflict: { serverVersion: number } | null;
}

interface CloudSyncActions {
  /**
   * Save the active project to the cloud.
   *
   * During an open conflict the save refuses with `conflict-pending` unless
   * `force: true` is passed — only the conflict banner's explicit Save may
   * force-overwrite the server version (BR-1).
   *
   * Returns a `SaveOutcome` discriminated union:
   * - `saved`/`created`/`noop` — terminal success (or nothing to do).
   * - `login-required` — deferred to the login dialog.
   * - `lock-held` — mutation lock busy; safe to retry.
   * - `not-found`/`conflict` — server-side state handled (no retry).
   * - `local-persist-failed` — server write succeeded but the local write failed.
   * - `conflict-pending` — open conflict; refused without `force: true`.
   */
  saveToCloud: (opts?: { force?: boolean }) => Promise<SaveOutcome>;
  saveProjectToCloud: (localId: string) => Promise<void>;
  deleteFromCloud: () => Promise<void>;
  deleteProjectFromCloud: (localId: string) => Promise<void>;
  setVisibility: (v: Visibility) => Promise<void>;
  setProjectVisibility: (localId: string, v: Visibility) => Promise<void>;
  loadCloudProject: (cloudId: string) => Promise<void>;
  fork: () => Promise<void>;
  dismissError: () => void;
  /** Dismiss the login dialog and cancel any pending cloud operation. */
  dismissLogin: () => void;
  initFromProject: (
    cloudId: string | null,
    isOwner: boolean,
    storage?: 'local' | 'cloud',
    metadata?: Pick<CloudInit, 'serverVersion' | 'cloudSavedAt' | 'visibility' | 'cloudConflictVersion' | 'hasUnsyncedChanges'>,
  ) => void;
  syncCloudProjects: () => Promise<SyncResult>;
  unlinkCloudProject: (localId: string) => void;
  /** Pull the latest server version, replacing local state. Used by the conflict banner. */
  loadServerVersion: () => Promise<void>;
  /** Flush any pending cloud sync immediately (best-effort, for beforeunload). */
  flushCloudSync: () => Promise<void>;
}

const CloudSyncStateContext = createContext<CloudSyncState | null>(null);
const CloudSyncActionsContext = createContext<CloudSyncActions | null>(null);

/**
 * Manages cloud synchronization state for the active project.
 *
 * Architecture: split into two contexts (state + actions) to avoid
 * re-rendering consumers that only need actions. Cloud state tracks
 * the active project's cloudId, ownership, dirty status (generation-
 * counter pattern via useCloudSyncEngine), and operation status.
 *
 * Refs (appStateRef, internalRef, activeLocalIdRef) are used to give
 * stable callbacks access to latest values without appearing in
 * dependency arrays — this keeps the actions object referentially
 * stable across renders. `initFromProject` additionally updates
 * `internalRef` synchronously (before the dispatch) so that the
 * `activeLocalId` effect's guard sees the cloudId immediately and
 * skips, preventing a race where both effects fire in the same commit.
 *
 * By-localId operations (saveProjectToCloud, deleteProjectFromCloud,
 * setProjectVisibility, unlinkCloudProject) are delegated to
 * useProjectCloudOps for use by the My Projects dialog.
 *
 * PERF-1: Decomposed hooks may trigger 2-4 extra renders per project switch
 * via cascading dispatches. This is inherent to the hook-based architecture
 * and is not user-visible (no layout thrashing). If profiling reveals jank,
 * consolidate to useReducer. See .full-review/05-final-report.md.
 */
export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const appState = useAppState();
  const dispatch = useAppDispatch();
  const { activeLocalId, projects, lastDeparture, isUnsaved } = useProjectStorage();
  const {
    updateCloudMetadata,
    createNewProject,
    refreshProjectList,
    switchProject,
    registerDepartureSnapshotter,
    loadAsUnsaved,
    saveCurrentProject,
  } = useProjectStorageActions();
  const { user: authUser } = useAuth();
  const { getJwt, registerPreLogout } = useAuthActions();

  // S14b: cloud-sync state lives behind a reducer (`cloudSyncReducer`). Every
  // writer dispatches a named action directly; the temporary `__RAW` passthrough
  // and the `setInternal` shim were removed at cleanup.
  const [internal, dispatch__internal] = useReducer(cloudSyncReducer, initialInternalState);

  const activeLocalIdRef = useRef(activeLocalId);
  useEffect(() => {
    activeLocalIdRef.current = activeLocalId;
  }, [activeLocalId]);

  const isUnsavedRef = useRef(isUnsaved);
  useEffect(() => {
    isUnsavedRef.current = isUnsaved;
  }, [isUnsaved]);

  const projectsRef = useRef(projects);
  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  // IMPORTANT: Assigned during render (not in useEffect) so that initFromProject's
  // synchronous ref write in a child effect isn't clobbered by a parent sync effect
  // running later in the same commit — which also breaks under React StrictMode's
  // double-invocation of effects. Do not move to useEffect without verifying the
  // initFromProject race described in the CloudSyncProvider docstring.
  // S3 landmine: the useState→useReducer swap does NOT change same-commit
  // `.current` visibility. This render-time mirror, and the inline synchronous
  // `internalRef.current = next` writes that precede a dispatch below, are
  // correctness devices that MUST be retained — dispatching an action does
  // not make the next state visible to refs within the same commit either.
  const internalRef = useRef(internal);
  internalRef.current = internal; // intentional render-time sync; see docstring above

  // Shared refs + reducer dispatch passed to all cloud sync hooks (AR-1: reduces
  // per-hook param count). All items are stable across renders (refs, and the
  // reducer dispatch is referentially stable).
  const core: CloudSyncCore = useMemo(
    () => ({ internalRef, activeLocalIdRef, dispatch: dispatch__internal }),
    [],
  );

  // Ref to avoid stale closures in save/fork callbacks.
  // Synced via useEffect (not render-time assignment) because appStateRef doesn't
  // need same-commit synchronous visibility — callbacks that read it run async.
  // Compare: internalRef uses render-time sync for initFromProject's same-commit guard.
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  // Freshness check throttle — reset on project switch
  const lastFreshnessCheckRef = useRef(0);

  // saveToCloud ref: breaks the circular dependency between useCloudSyncEngine
  // (needs saveToCloud) and useActiveProjectCloudOps (needs refs from the engine).
  // The engine only calls saveToCloud asynchronously (inside setTimeout), so a ref is safe.
  // The wrapper forwards `opts` (BR-1): a zero-arg wrapper would silently drop
  // the banner's `force: true` and the forced save would refuse as conflict-pending.
  const saveToCloudRef = useRef<(opts?: { force?: boolean }) => Promise<SaveOutcome>>(() => Promise.resolve('lock-held' as SaveOutcome));
  const saveToCloudStable = useCallback((opts?: { force?: boolean }) => saveToCloudRef.current(opts), []);

  // Merged dirty tracking + auto-sync engine
  const canAutoSync = internal.storage === 'cloud' && internal.isOwner && !!authUser && !internal.conflict;
  const { isDirty, syncStatus, flushCloudSync, syncTimerRef, dataVersionRef, mutationLockRef } = useCloudSyncEngine({
    dataDeps: appState,
    internal,
    dispatch: dispatch__internal,
    canAutoSync,
    getJwt,
    saveToCloud: saveToCloudStable,
  });

  useEffect(() => {
    registerDepartureSnapshotter((meta) => {
      const current = internalRef.current;
      const isDepartingActiveProject = activeLocalIdRef.current === meta.localId
        && current.cloudId === meta.cloudId;
      // selectWasDirty folds the former `cloudId !== null && dataVersion !==
      // lastSavedVersion` dirty check onto the baseline union (DESIGN §5).
      const wasDirty = isDepartingActiveProject
        && selectWasDirty(current, dataVersionRef.current);
      return {
        wasDirty,
        serverVersion: positiveVersion(current.serverVersion) ?? meta.serverVersion,
      };
    });
    return () => registerDepartureSnapshotter(null);
  }, [registerDepartureSnapshotter, dataVersionRef]);

  // Shared freshness check context — stable refs and callbacks reused across all call sites.
  // All items are refs or stable functions — empty deps array is correct.
  const freshnessCtx: FreshnessCheckContext = useMemo(
    () => ({
      internalRef, activeLocalIdRef, dataVersionRef, dispatch,
      lastFreshnessCheckRef, updateCloudMetadata, cloudDispatch: dispatch__internal,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Active-project cloud operations (save, fork, delete, visibility, load)
  // Login guard state (loginRequired, pendingOpRef, dismissLogin) is now
  // absorbed into useActiveProjectCloudOps.
  const { ops: activeOps, loginRequired, pendingOpRef, dismissLogin } = useActiveProjectCloudOps({
    core, appStateRef,
    dataVersionRef, mutationLockRef, lastFreshnessCheckRef,
    updateCloudMetadata, createNewProject, loadAsUnsaved, getJwt, dispatch,
  });
  saveToCloudRef.current = activeOps.saveToCloud;

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
    (
      cloudId: string | null,
      isOwner: boolean,
      storage: 'local' | 'cloud' = cloudId && isOwner ? 'cloud' : 'local',
      metadata: Pick<CloudInit, 'serverVersion' | 'cloudSavedAt' | 'visibility' | 'cloudConflictVersion' | 'hasUnsyncedChanges'> = {},
    ) => {
      if (cloudId === null) {
        const next = { ...initialInternalState, storage };
        internalRef.current = next;
        dispatch__internal({ type: 'INIT_LOCAL', storage });
        clearCloudUrl();
      } else {
        const hasStoredUnsyncedChanges = metadata.hasUnsyncedChanges === true;
        // Path A of the unified init (S10a / DESIGN §3a): build the flat INIT
        // state via the shared pure `cloudStateForEntry`. Baseline seeding is
        // NOT a divergence (BR-4): both paths carry the clean/dirty split in
        // the seed — `dirty` for stored unsynced changes, otherwise `untracked`
        // (awaiting capture), which the engine resolves to a `clean` baseline
        // at the real post-first-tick generation. Snapshotting
        // `dataVersionRef.current` here raced the engine's first tick: this
        // mount-effect init runs BEFORE the engine bumps the generation, so a
        // clean owned cloud project read as dirty and fired a no-op load-time
        // PUT. The three divergences from Path B (`useProjectSwitchInit`) are
        // explicit decisions here:
        //   • lastCloudSavedAt — Path A threads `metadata.cloudSavedAt` (carried
        //     in the seed, vs Path B's hardcoded null).
        //   • setCloudUrl — DELIBERATELY OMITTED on Path A's cloud branch:
        //     initFromProject runs at startup where AppLoader already owns the
        //     URL, so it intentionally does not call setCloudUrl(cloudId).
        //   • freshness kickoff — Path A does NOT kick off a freshness check.
        const seed = cloudStateForEntry({
          prev: internalRef.current,
          cloudId,
          isOwner,
          storage,
          shareUrl: buildProjectUrl(cloudId),
          lastCloudSavedAt: metadata.cloudSavedAt ?? null,
          visibility: metadata.visibility ?? 'private',
          serverVersion: normalizeServerVersion(metadata.serverVersion),
          conflictVersion: metadata.cloudConflictVersion ?? null,
          hasUnsyncedChanges: hasStoredUnsyncedChanges,
        });
        // Synchronous ref write so the activeLocalId effect's guard
        // (cloudId === internalRef.current.cloudId) sees this in the same commit.
        internalRef.current = seed;
        dispatch__internal({ type: 'INIT_CLOUD', seed });
      }
    },
    [],
  );

  const dismissError = useCallback(() => {
    dispatch__internal({ type: 'CLEAR_ERROR' });
  }, []);

  const syncCloudProjects = useCallback(async (): Promise<SyncResult> => {
    const emptyResult: SyncResult = {
      updatedCount: 0,
      staleCloudIds: [],
      staleReconciledCloudIds: [],
      staleReconcileFailedCloudIds: [],
      placeholdersCreated: 0,
    };
    if (!isCloudEnabled()) return emptyResult;

    const jwt = getJwt();
    if (!jwt) return emptyResult;

    const reconcileDeps: SyncReconcileDeps = {
      internalRef, activeLocalIdRef, appStateRef, syncTimerRef,
      mutationLockRef, dispatchInternal: dispatch__internal, updateCloudMetadata,
    };

    const latestProjects = loadManifest().projects.map(toProjectListEntry);
    return syncCloudProjectsFromServer(jwt, latestProjects, {
      updateCloudMetadata,
      reconcileStaleCloudProject: (project, options) =>
        reconcileStaleCloudProjectImpl(reconcileDeps, project, options),
      createPlaceholder: (data, options) =>
        createPlaceholderImpl(reconcileDeps, data, options),
    });
  }, [appStateRef, mutationLockRef, syncTimerRef, updateCloudMetadata, getJwt]);

  // Callback ref: nullable because the callback references state/hooks defined below.
  // Direct assignment in render (not useEffect) ensures it's fresh by the time
  // effects in child hooks read it. The `| null` type forces consumers to use
  // optional chaining, preventing calls before initialization.
  const syncCloudProjectsRef = useRef<(() => Promise<SyncResult>) | null>(null);
  syncCloudProjectsRef.current = syncCloudProjects; // render-time sync for stable callback refs

  // Auth transition: sign-in retry, cloud sync, sign-out cleanup
  useAuthTransition({
    core, authUser,
    pendingOpRef,
    saveToCloud: activeOps.saveToCloud,
    fork: activeOps.fork,
    dismissLogin,
    syncCloudProjectsRef, syncTimerRef,
    refreshProjectList, switchProject, createNewProject,
  });

  // --- Active project switch: cloud state init + best-effort save ---
  useProjectSwitchInit({
    core, activeLocalId, projects,
    projectsRef, syncTimerRef,
    dataVersionRef, mutationLockRef, getJwt, lastFreshnessCheckRef, updateCloudMetadata,
    dispatch,
    lastDeparture,
  });

  // Freshness check when tab regains focus
  useEffect(() => {
    let cancelled = false;

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (cancelled) return;

      const { cloudId, serverVersion } = internalRef.current;
      if (!cloudId || serverVersion === 0) return;
      const jwt = getJwt();
      if (!jwt) return;
      const localId = activeLocalIdRef.current;

      checkAndPullFreshVersion(freshnessCtx, {
        cloudId,
        knownVersion: serverVersion,
        localId,
        jwt,
      }).catch((err) => {
        if (import.meta.env.DEV) console.warn('Freshness check failed:', err);
      });
    };

    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
    };
  // All deps are refs or stable functions — empty array is correct
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-evaluate ownership when auth state changes or the active cloud project
  // changes while authenticated. Covers: (1) JWT validated after startup,
  // (2) project switch while already authenticated (e.g., via My Projects).
  useEffect(() => {
    if (!internal.cloudId || internal.isOwner || !authUser) return;

    const jwt = getJwt();
    if (!jwt) return;

    const checkedCloudId = internal.cloudId;
    let cancelled = false;
    getProject(checkedCloudId, jwt)
      .then((res) => {
        // Verify user is still authenticated when response arrives (SEC-M3)
        if (cancelled || !res.isOwner || !getJwt()) return;

        let promotedLocalId = activeLocalIdRef.current;
        if (!promotedLocalId && isUnsavedRef.current) {
          promotedLocalId = saveCurrentProject();
          if (!promotedLocalId) {
            dispatch__internal({
              type: 'SET_ERROR',
              ifCloudId: checkedCloudId,
              error: 'Cloud ownership was confirmed, but the project could not be saved locally.',
            });
            return;
          }
        }

        // Reproduces the former `dataVersion !== lastSavedVersion`: a `clean`
        // baseline has edits iff the generation drifted; `dirty`/`untracked`
        // baselines (former MAX_SAFE_INTEGER/-1 sentinels) always count as edited.
        const baseline = internalRef.current.baseline;
        const hasLocalEdits = baseline.kind !== 'clean'
          || dataVersionRef.current !== baseline.version;
        const confirmedCloudSavedAt = res.updatedAt ?? internalRef.current.lastCloudSavedAt;
        const confirmedVisibility = res.visibility ?? internalRef.current.visibility;
        if (promotedLocalId) {
          const metadataResult = updateCloudMetadata(promotedLocalId, {
            cloudId: checkedCloudId,
            storage: 'cloud',
            serverVersion: res.version,
            cloudSavedAt: confirmedCloudSavedAt,
            visibility: confirmedVisibility,
            cloudConflictVersion: null,
            hasUnsyncedChanges: hasLocalEdits,
          });
          if (!metadataResult.ok) {
            dispatch__internal({
              type: 'SET_ERROR',
              ifCloudId: checkedCloudId,
              error: 'Cloud ownership was confirmed, but local cloud metadata could not be persisted.',
            });
            return;
          }
        }

        dispatch__internal({
          type: 'OWNERSHIP_CONFIRMED',
          ifCloudId: checkedCloudId,
          serverVersion: res.version,
          cloudSavedAt: confirmedCloudSavedAt,
          visibility: confirmedVisibility,
        });
      })
      .catch(() => { /* best-effort; ownership stays false */ });
    return () => { cancelled = true; };
  }, [authUser, getJwt, internal.cloudId, internal.isOwner, saveCurrentProject, updateCloudMetadata, dataVersionRef]);

  // By-localId cloud operations (used by My Projects dialog)
  const projectOps = useProjectCloudOps({
    core, updateCloudMetadata, projectsRef,
    mutationLockRef, getJwt,
    activeProjectSave: activeOps.saveToCloud,
  });

  // Pre-logout flush: while the JWT is still valid, push the active project's
  // pending changes and best-effort save other dirty owned cloud projects.
  // Anything still dirty after the flush is demoted (not deleted) by purgeCloudProjects.
  useEffect(() => {
    registerPreLogout(async () => {
      // 1. Push the active project's pending changes (writes local + cloud).
      await flushCloudSync();
      // 2. Best-effort save of other dirty owned cloud projects. Conflicted
      //    entries are excluded (mirrors use-project-switch-init): flushing them
      //    would force-overwrite the other device AND clear cloudConflictVersion,
      //    letting purge EVICT instead of demote. They fall through to
      //    purgeCloudProjects' demote branch with their local data kept.
      const dirty = loadManifest().projects.filter(
        (p) => isOwnedCloudEntry(p) && p.hasUnsyncedChanges && p.cloudConflictVersion == null
          && p.localId !== activeLocalIdRef.current,
      );
      for (const entry of dirty) {
        try {
          await projectOps.saveProjectToCloud(entry.localId);
        } catch {
          // Best-effort; anything still dirty is demoted (not lost) by purge.
        }
      }
    });
    return () => registerPreLogout(null);
  }, [registerPreLogout, flushCloudSync, projectOps]);

  const loadServerVersion = useCallback(async () => {
    const { cloudId } = internalRef.current;
    if (!cloudId) return;
    const jwt = getJwt();
    if (!jwt) return;
    const localId = activeLocalIdRef.current;

    const pullResult = await checkAndPullFreshVersion(freshnessCtx, {
      cloudId,
      knownVersion: 0,
      localId,
      jwt,
      mode: 'replace-with-server',
    });

    if (pullResult.applied) {
      dispatch__internal({ type: 'CLEAR_CONFLICT' });
    }
  }, [freshnessCtx, getJwt]);

  const actions = useMemo(
    () => ({
      ...activeOps,
      dismissError, dismissLogin, initFromProject, syncCloudProjects,
      loadServerVersion,
      flushCloudSync,
      ...projectOps,
    }),
    [activeOps, dismissError, dismissLogin, initFromProject, syncCloudProjects, loadServerVersion, flushCloudSync, projectOps],
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
      loginRequired,
      syncStatus,
      conflict: internal.conflict,
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
      loginRequired,
      syncStatus,
      internal.conflict,
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
