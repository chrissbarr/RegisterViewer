import { useEffect, useMemo, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { buildProjectUrl, evictProjectData } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl } from '../utils/cloud-url';
import type { InternalCloudSyncState } from '../types/cloud-sync';
import type { ProjectListEntry } from '../types/project';
import type { AppState } from '../types/register';

interface UseProjectSwitchEvictionDeps {
  activeLocalId: string | null;
  appState: AppState;
  projects: ProjectListEntry[];
  internalRef: MutableRefObject<InternalCloudSyncState>;
  projectsRef: MutableRefObject<ProjectListEntry[]>;
  activeLocalIdRef: MutableRefObject<string | null>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  lastStableStateRef: MutableRefObject<{ localId: string | null; state: AppState }>;
  flushSyncRef: MutableRefObject<((stateOverride?: AppState) => Promise<void>) | null>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  isSigningOutRef: MutableRefObject<boolean>;
  cancelPendingOp: () => void;
  setInternal: Dispatch<SetStateAction<InternalCloudSyncState>>;
  initialInternalState: InternalCloudSyncState;
}

/**
 * Handles project switch eviction and cloudId tracking.
 *
 * When the active project changes:
 * 1. Flushes pending cloud sync for the previous project, then evicts
 *    its localStorage data (cloud-backed projects only).
 * 2. Updates internal cloud state to match the new project's cloudId.
 * 3. Clears stale login guard state from the previous project.
 *
 * IMPORTANT: `lastStableStateRef` must be updated during render in the
 * parent component (not in a useEffect). This hook reads but does not
 * create the ref. See CloudSyncProvider for the render-time update.
 */
export function useProjectSwitchEviction(deps: UseProjectSwitchEvictionDeps): void {
  const {
    activeLocalId, appState, projects,
    internalRef, projectsRef, activeLocalIdRef, needsVersionSyncRef,
    lastStableStateRef, flushSyncRef, syncTimerRef, isSigningOutRef,
    cancelPendingOp, setInternal, initialInternalState,
  } = deps;

  const prevActiveLocalIdRef = useRef<string | null>(null);

  // Derive the active project's cloudId so the effect re-runs when it changes
  // (e.g., after auto-upload sets a cloudId on a previously local-only project).
  const activeCloudId = useMemo(
    () => projects.find(p => p.localId === activeLocalId)?.cloudId ?? null,
    [projects, activeLocalId],
  );

  useEffect(() => {
    // Evict previous cloud project's data from localStorage on switch
    const prevLocalId = prevActiveLocalIdRef.current;
    prevActiveLocalIdRef.current = activeLocalId;
    if (prevLocalId && prevLocalId !== activeLocalId) {
      // Grab the previous project's state snapshot before updating the ref.
      // After switchProject, appStateRef already holds the *new* project's state,
      // so we pass the snapshot to flushSync to save the correct data.
      const prevState = lastStableStateRef.current.localId === prevLocalId
        ? lastStableStateRef.current.state
        : undefined;
      // Update the snapshot ref for the new project
      lastStableStateRef.current = { localId: activeLocalId, state: appState };

      const prevEntry = projectsRef.current.find(p => p.localId === prevLocalId);
      if (prevEntry?.storage === 'cloud' && prevEntry.cloudId) {
        // Flush pending sync first, then evict — only on success and only if
        // the user hasn't navigated back to this project in the meantime.
        // Skip during sign-out to avoid racing with purgeCloudProjects.
        flushSyncRef.current?.(prevState).then(() => {
          if (activeLocalIdRef.current === prevLocalId) return; // user navigated back
          if (isSigningOutRef.current) return; // sign-out purge handles cleanup
          evictProjectData(prevLocalId);
        }).catch(() => {
          // Flush failed — keep local data as safety net
        });
      }
    }

    if (!activeLocalId) {
      // Reset cloud sync state when transitioning from a saved project to
      // an unsaved one (e.g. New Project). This prevents stale cloud state
      // from the previous project triggering auto-sync on the empty project.
      // Skip on initial mount (prevLocalId is null) so that initFromProject
      // can set up cloud state for shared projects loaded from #/p/{id} URLs.
      if (prevLocalId) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        cancelPendingOp();
        setInternal({ ...initialInternalState });
        clearCloudUrl();
      }
      return;
    }

    const entry = projectsRef.current.find(p => p.localId === activeLocalId);
    const cloudId = entry?.cloudId ?? null;
    // Skip if cloudId hasn't changed (avoid redundant state updates)
    if (cloudId === internalRef.current.cloudId) return;
    // Clear any pending cloud operation from the previous project
    cancelPendingOp();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataVersionRef is a ref (stable); activeCloudId triggers re-eval when cloudId changes after upload; appState is intentionally read only during project transitions (render-time ref handles steady-state updates)
  }, [activeLocalId, activeCloudId]);
}
