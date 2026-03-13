import { useEffect, useRef, type MutableRefObject } from 'react';
import { purgeCloudProjects, getMostRecentProjectId, ACTIVE_PROJECT_SESSION_KEY } from '../utils/project-storage';
import { clearCloudUrl } from '../utils/cloud-utils';
import { type CloudSyncCore, type SyncResult, initialInternalState } from '../types/cloud-sync';

interface UseAuthTransitionDeps {
  core: CloudSyncCore;
  authUser: { email: string } | null;
  pendingCloudOpRef: MutableRefObject<'save' | 'fork' | null>;
  setLoginRequired: (v: boolean) => void;
  rawSave: () => Promise<boolean>;
  rawFork: () => Promise<void>;
  syncCloudProjectsRef: MutableRefObject<(() => Promise<SyncResult>) | null>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  refreshProjectList: () => void;
  switchProject: (id: string) => void;
  createNewProject: () => string;
}

interface UseAuthTransitionResult {
  isSigningOutRef: MutableRefObject<boolean>;
}

/**
 * Handles auth state transitions (sign-in / sign-out).
 *
 * On sign-in (null→user) or first mount with existing auth:
 * - Retries any pending cloud operation deferred by the login guard.
 * - Syncs cloud project metadata from the server.
 *
 * On sign-out (user→null):
 * - Purges all cloud-storage projects from localStorage.
 * - Switches to a remaining local project or creates a new one.
 * - Resets cloud sync state.
 */
export function useAuthTransition(deps: UseAuthTransitionDeps): UseAuthTransitionResult {
  const {
    core: { activeLocalIdRef, setInternal },
    authUser, pendingCloudOpRef, setLoginRequired, rawSave, rawFork,
    syncCloudProjectsRef, syncTimerRef,
    refreshProjectList, switchProject, createNewProject,
  } = deps;

  const prevAuthUserRef = useRef(authUser);
  const hasRunInitialSyncRef = useRef(false);
  const isSigningOutRef = useRef(false);

  useEffect(() => {
    const wasNull = prevAuthUserRef.current === null;
    const wasLoggedIn = prevAuthUserRef.current !== null;
    prevAuthUserRef.current = authUser;

    // Trigger sync when user signs in (null→user) OR on first mount if already authenticated
    const shouldSync = (wasNull && authUser) || (!hasRunInitialSyncRef.current && authUser);

    if (shouldSync) {
      hasRunInitialSyncRef.current = true;
      // Reset sign-out flag on sign-in (kept true after sign-out to protect
      // async eviction checks — see use-project-switch-eviction.ts)
      isSigningOutRef.current = false;
      // Sign-in: retry any pending cloud operation that was deferred
      if (pendingCloudOpRef.current) {
        const op = pendingCloudOpRef.current;
        pendingCloudOpRef.current = null;
        setLoginRequired(false);
        if (op === 'save') {
          // Error already surfaced via internal.error UI state
          rawSave().catch(() => {});
        } else if (op === 'fork') {
          rawFork().catch(() => {});
        }
      }
      // Sync cloud projects (pull metadata from server)
      syncCloudProjectsRef.current?.().catch(() => { /* best-effort on mount/sign-in */ });
    }

    if (wasLoggedIn && !authUser) {
      hasRunInitialSyncRef.current = false;
      isSigningOutRef.current = true;
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
      setInternal(initialInternalState);
      clearCloudUrl();
      sessionStorage.removeItem(ACTIVE_PROJECT_SESSION_KEY);
    }
  }, [authUser, rawSave, rawFork, pendingCloudOpRef, setLoginRequired, syncCloudProjectsRef, syncTimerRef, activeLocalIdRef, setInternal, refreshProjectList, switchProject, createNewProject]);

  return { isSigningOutRef };
}
