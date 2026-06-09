import { useEffect, useRef, type MutableRefObject } from 'react';
import { purgeCloudProjects, getMostRecentProjectId, ACTIVE_PROJECT_SESSION_KEY } from '../utils/project-storage';
import { clearCloudUrl } from '../utils/cloud-utils';
import { type CloudSyncCore, type SaveOutcome, type SyncResult } from '../types/cloud-sync';

interface UseAuthTransitionDeps {
  core: CloudSyncCore;
  authUser: { email: string } | null;
  pendingOpRef: MutableRefObject<'save' | 'fork' | null>;
  saveToCloud: () => Promise<SaveOutcome>;
  fork: () => Promise<void>;
  dismissLogin: () => void;
  syncCloudProjectsRef: MutableRefObject<(() => Promise<SyncResult>) | null>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  refreshProjectList: () => void;
  switchProject: (id: string) => boolean;
  createNewProject: () => string | null;
}

/**
 * Handles auth state transitions (sign-in / sign-out).
 *
 * On sign-in (null→user) or first mount with existing auth:
 * - Retries any pending cloud operation deferred by the login guard.
 * - Syncs cloud project metadata from the server.
 *
 * On sign-out (user→null):
 * - Removes clean (fully-synced) cloud projects from localStorage; demotes
 *   dirty/conflicted ones to local projects so unsynced edits are never lost.
 * - Re-homes to a remaining project (or creates one) only when the active
 *   project was removed; a demoted active project stays put.
 * - Resets cloud sync state.
 */
export function useAuthTransition(deps: UseAuthTransitionDeps): void {
  const {
    core: { activeLocalIdRef, dispatch: cloudDispatch },
    authUser, pendingOpRef, saveToCloud, fork, dismissLogin,
    syncCloudProjectsRef, syncTimerRef,
    refreshProjectList, switchProject, createNewProject,
  } = deps;

  const prevAuthUserRef = useRef(authUser);
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
      const pendingOp = pendingOpRef.current;
      if (pendingOp) {
        pendingOpRef.current = null;
        dismissLogin();
        if (pendingOp === 'save') {
          saveToCloud().catch((err) => {
            if (import.meta.env.DEV) console.warn('Auto-retry save failed:', err);
          });
        } else if (pendingOp === 'fork') {
          fork().catch((err) => {
            if (import.meta.env.DEV) console.warn('Auto-retry fork failed:', err);
          });
        }
      }
      // Sync cloud projects (pull metadata from server)
      syncCloudProjectsRef.current?.()
        .then((result) => {
          if (result.placeholdersCreated > 0 || result.staleReconciledCloudIds.length > 0) {
            refreshProjectList();
          }
        })
        .catch(() => { /* best-effort on mount/sign-in */ });
    }

    if (wasLoggedIn && !authUser) {
      hasRunInitialSyncRef.current = false;
      // Sign-out: purge cloud projects from localStorage
      const { removed } = purgeCloudProjects();
      refreshProjectList();

      // Re-home only if the active project was actually removed (a demoted one
      // stays put as a now-local project).
      if (activeLocalIdRef.current && removed.includes(activeLocalIdRef.current)) {
        const remaining = getMostRecentProjectId();
        if (remaining) {
          switchProject(remaining);
        } else {
          const newId = createNewProject();
          if (newId) switchProject(newId);
        }
      }

      // Reset cloud sync state. LIFECYCLE_RESET returns the frozen
      // initialInternalState by reference (same Object.is bail-out as the former
      // value-form `setInternal(initialInternalState)` reset).
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      cloudDispatch({ type: 'LIFECYCLE_RESET' });
      clearCloudUrl();
      sessionStorage.removeItem(ACTIVE_PROJECT_SESSION_KEY);
    }
  }, [authUser, saveToCloud, fork, pendingOpRef, dismissLogin, syncCloudProjectsRef, syncTimerRef, activeLocalIdRef, cloudDispatch, refreshProjectList, switchProject, createNewProject]);
}
