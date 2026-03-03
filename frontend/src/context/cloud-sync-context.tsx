/**
 * CloudSyncProvider — cloud save/load/fork/delete/sync for the active project.
 *
 * Cloud operations are split across three hooks:
 * - **Active-project ops** (`useActiveProjectCloudOps`): `saveToCloud`,
 *   `deleteFromCloud`, `setVisibility`, `fork`, `loadCloudProject` — operate
 *   on the currently-loaded project using in-memory `appState` via refs.
 * - **By-localId ops** (`useProjectCloudOps`): operates on any project by
 *   `localId`, reading state from localStorage. Used by the My Projects dialog.
 * - **This provider**: orchestrates state, refs, effects, and delegates to the
 *   two hooks above. Also owns `initFromProject`, `dismissError`, and
 *   `syncCloudProjects`.
 *
 * Both operation hooks delegate shared API logic to `cloud-operations.ts`.
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
import {
  isCloudEnabled,
  listProjects,
  getProject,
} from '../utils/api-client';
import { useAuth, useAuthActions } from './auth-context';
import { buildProjectUrl, createProject, purgeCloudProjects, getMostRecentProjectId, evictProjectData, ACTIVE_PROJECT_SESSION_KEY } from '../utils/project-storage';
import { EMPTY_SERIALIZED_STATE } from '../utils/storage';
import { clearCloudUrl, setCloudUrl } from '../utils/cloud-url';
import { useDirtyTracking } from '../hooks/use-dirty-tracking';
import { useActiveProjectCloudOps } from '../hooks/use-active-project-cloud-ops';
import { useProjectCloudOps } from '../hooks/use-project-cloud-ops';
import { DEFAULT_PROJECT_NAME, type ProjectListEntry, type Visibility } from '../types/project';
import { CLOUD_SYNC_DEBOUNCE_MS } from '../constants';

export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'local-only';

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

  // Sync cloud state when active project changes (handles project switch)
  // Assigned during render (not in useEffect) so that initFromProject's
  // synchronous ref write in a child effect isn't clobbered by a parent
  // sync effect running later in the same commit — which also breaks under
  // React StrictMode's double-invocation of effects.
  const internalRef = useRef(internal);
  internalRef.current = internal;

  const prevActiveLocalIdRef = useRef<string | null>(null);

  // Derive the active project's cloudId so the effect re-runs when it changes
  // (e.g., after auto-upload sets a cloudId on a previously local-only project).
  const activeCloudId = projects.find(p => p.localId === activeLocalId)?.cloudId ?? null;

  useEffect(() => {
    if (!activeLocalId) return;

    // Evict previous cloud project's data from localStorage on switch
    const prevLocalId = prevActiveLocalIdRef.current;
    prevActiveLocalIdRef.current = activeLocalId;
    if (prevLocalId && prevLocalId !== activeLocalId) {
      const prevEntry = projectsRef.current.find(p => p.localId === prevLocalId);
      if (prevEntry?.storage === 'cloud') {
        // Flush pending sync first, then evict — only on success and only if
        // the user hasn't navigated back to this project in the meantime.
        flushSyncRef.current?.().then(() => {
          if (activeLocalIdRef.current === prevLocalId) return; // user navigated back
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
    pendingCloudOpRef.current = null;
    setLoginRequired(false);
    // Default to false; the auth re-evaluation effect (below)
    // will asynchronously promote isOwner via a server round-trip when the
    // user is authenticated.
    const isOwner = false;
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
        storage: entry?.storage ?? 'cloud',
        shareUrl: buildProjectUrl(cloudId),
        lastCloudSavedAt: null,
        error: null,
        visibility: entry?.visibility ?? 'private',
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersionRef is a ref (stable); activeCloudId triggers re-eval when cloudId changes after upload
  }, [activeLocalId, activeCloudId]);

  // Ref to avoid stale closures in save/fork callbacks
  const appStateRef = useRef(appState);
  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

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
        if (!cancelled && res.isOwner) {
          setInternal((prev) => prev.cloudId === internal.cloudId ? { ...prev, isOwner: true } : prev);
        }
      })
      .catch(() => { /* best-effort; ownership stays false */ });
    return () => { cancelled = true; };
  }, [authUser, getJwt, internal.cloudId, internal.isOwner]);

  // Login-before-save: when a cloud op is attempted without a JWT,
  // store the pending op type and show the login dialog. After login,
  // the auth-transition effect retries the operation automatically.
  const [loginRequired, setLoginRequired] = useState(false);
  const pendingCloudOpRef = useRef<'save' | 'fork' | null>(null);

  // Active-project cloud operations (save, fork, delete, visibility, load)
  const rawActiveOps = useActiveProjectCloudOps({
    internalRef, appStateRef, activeLocalIdRef,
    dataVersionRef, mutationLockRef, needsVersionSyncRef,
    setInternal, updateCloudMetadata, createNewProject,
    getJwt, dispatch, initialInternalState,
  });

  // --- Cloud auto-sync (debounced after dirty) ---
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('local-only');

  // Derive whether auto-sync should be active
  const canAutoSync = internal.storage === 'cloud' && internal.isOwner && !!authUser;

  useEffect(() => {
    if (!canAutoSync) {
      setSyncStatus('local-only');
      return;
    }
    if (!isDirty) {
      setSyncStatus('saved');
      return;
    }

    syncTimerRef.current = setTimeout(async () => {
      const jwt = getJwt();
      if (!jwt) return;
      setSyncStatus('syncing');
      try {
        await rawActiveOps.saveToCloud();
        setSyncStatus('saved');
      } catch {
        setSyncStatus('offline');
        // No automatic retry — the next user edit will trigger a fresh sync attempt
      }
    }, CLOUD_SYNC_DEBOUNCE_MS);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  }, [isDirty, canAutoSync, getJwt, rawActiveOps]);

  const flushSync = useCallback(async () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    // Derive dirty status from refs so this callback is referentially stable
    // (isDirty in the dep array caused a stale-closure duplicate PUT).
    const { cloudId, isOwner, lastSavedVersion } = internalRef.current;
    if (!cloudId || !isOwner || dataVersionRef.current === lastSavedVersion) return;
    const jwt = getJwt();
    if (!jwt) return;
    await rawActiveOps.saveToCloud();
    // saveToCloud catches internally and sets error state — propagate as rejection
    if (internalRef.current.error) {
      throw new Error('Cloud sync failed');
    }
  }, [getJwt, rawActiveOps, dataVersionRef]);

  // Wrap save/fork with JWT guards
  const saveToCloud = useCallback(async () => {
    if (!getJwt()) {
      pendingCloudOpRef.current = 'save';
      setLoginRequired(true);
      return;
    }
    return rawActiveOps.saveToCloud();
  }, [getJwt, rawActiveOps]);

  const forkProject = useCallback(async () => {
    if (!getJwt()) {
      pendingCloudOpRef.current = 'fork';
      setLoginRequired(true);
      return;
    }
    return rawActiveOps.fork();
  }, [getJwt, rawActiveOps]);

  const activeOps = useMemo(() => ({
    ...rawActiveOps,
    saveToCloud,
    fork: forkProject,
  }), [rawActiveOps, saveToCloud, forkProject]);

  const cancelPendingOp = useCallback(() => {
    pendingCloudOpRef.current = null;
    setLoginRequired(false);
  }, []);

  // Auth-transition effect: when the user transitions from logged-out (null)
  // to logged-in (non-null), retry any pending cloud operation that was
  // deferred because a JWT was not available at the time of the request,
  // and sync cloud projects (pull metadata + upload local-only).
  // Note: syncCloudProjects ref is used to avoid forward-reference issues.
  const prevAuthUserRef = useRef(authUser);
  const syncCloudProjectsRef = useRef<(() => Promise<SyncResult>) | null>(null);
  const flushSyncRef = useRef<(() => Promise<void>) | null>(null);

  const initFromProject = useCallback(
    (cloudId: string | null, isOwner: boolean, storage: 'local' | 'cloud' = cloudId ? 'cloud' : 'local') => {
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
  syncCloudProjectsRef.current = syncCloudProjects;
  flushSyncRef.current = flushSync;

  const hasRunInitialSyncRef = useRef(false);

  useEffect(() => {
    const wasNull = prevAuthUserRef.current === null;
    const wasLoggedIn = prevAuthUserRef.current !== null;
    prevAuthUserRef.current = authUser;

    // Trigger sync when user signs in (null→user) OR on first mount if already authenticated
    const shouldSync = (wasNull && authUser) || (!hasRunInitialSyncRef.current && authUser);

    if (shouldSync) {
      hasRunInitialSyncRef.current = true;
      // Sign-in: retry any pending cloud operation that was deferred
      if (pendingCloudOpRef.current) {
        const op = pendingCloudOpRef.current;
        pendingCloudOpRef.current = null;
        setLoginRequired(false);
        if (op === 'save') {
          void rawActiveOps.saveToCloud();
        } else if (op === 'fork') {
          void rawActiveOps.fork();
        }
      }
      // Sync cloud projects (pull metadata + upload local-only)
      syncCloudProjectsRef.current?.().catch(() => { /* best-effort on mount/sign-in */ });
    }

    if (wasLoggedIn && !authUser) {
      hasRunInitialSyncRef.current = false;
      // Sign-out: purge cloud projects from localStorage
      const purgedIds = purgeCloudProjects();
      refreshProjectList();

      // If active project was purged, switch to a remaining project or create new
      if (activeLocalIdRef.current && purgedIds.includes(activeLocalIdRef.current)) {
        const remaining = getMostRecentProjectId();
        if (remaining) {
          switchProject(remaining);
        } else {
          const newId = createNewProject();
          switchProject(newId);
        }
      }

      // Reset cloud sync state
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      setInternal({ ...initialInternalState });
      clearCloudUrl();
      sessionStorage.removeItem(ACTIVE_PROJECT_SESSION_KEY);
    }
  }, [authUser, rawActiveOps, refreshProjectList, switchProject, createNewProject]);

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
      ...activeOps,
      dismissError, initFromProject, syncCloudProjects, cancelPendingOp, flushSync,
      ...projectOps,
    }),
    [activeOps, dismissError, initFromProject, syncCloudProjects, cancelPendingOp, flushSync, projectOps],
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
