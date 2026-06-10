import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { buildProjectUrl, loadProject, type ProjectStorageWriteResult } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, withMutationLock } from '../utils/cloud-utils';
import { exportToObject, deserializeState } from '../utils/storage';
import { saveProjectToCloudImpl } from '../utils/cloud-operations';
import { checkAndPullFreshVersion, type FreshnessCheckContext } from './use-cloud-freshness';
import { isOwnedCloudEntry } from '../utils/project-identity';
import { positiveVersion, normalizeServerVersion } from '../utils/cloud-sync';
import { cloudStateForEntry } from '../utils/cloud-sync-reducer';
import { type CloudSyncCore } from '../types/cloud-sync';
import type { CloudMetadataUpdate } from '../types/cloud-sync';
import type { ProjectListEntry } from '../types/project';
import type { ImportStateAction } from '../context/app-context';
import type { ProjectDepartureSnapshot } from '../context/project-storage-context';

interface UseProjectSwitchInitDeps {
  core: CloudSyncCore;
  activeLocalId: string | null;
  projects: ProjectListEntry[];
  projectsRef: MutableRefObject<ProjectListEntry[]>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  dataVersionRef: MutableRefObject<number>;
  mutationLockRef: MutableRefObject<boolean>;
  getJwt: () => string | null;
  lastFreshnessCheckRef: MutableRefObject<number>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  dispatch: (action: ImportStateAction) => void;
  lastDeparture: ProjectDepartureSnapshot | null;
}

// Maximum number of times scheduleRetry will re-arm attemptSave after a
// contended withMutationLock call. A wedged lock must not be allowed to drive
// an unbounded 4 Hz retry loop; the departing data is already durable in
// localStorage so giving up after the cap is safe (A-20).
const MAX_DEPARTURE_SAVE_RETRIES = 8;

/**
 * Handles project switch lifecycle: cloud state init and best-effort save.
 *
 * When the active project changes:
 * 1. **Best-effort save**: If the departing project is dirty and cloud-backed,
 *    fires a background save from localStorage data (fire-and-forget).
 * 2. **Cloud state init**: Updates internal cloud state to match the
 *    new project's cloudId, ownership, and storage type.
 * 3. **Cleanup**: Clears auto-sync timer and freshness throttle.
 *
 * Unlike the previous useProjectSwitchEviction, this hook does NOT evict
 * localStorage data - cloud projects stay cached locally.
 */
export function useProjectSwitchInit(deps: UseProjectSwitchInitDeps): void {
  const {
    core: { internalRef, dispatch: cloudDispatch },
    activeLocalId, projects,
    projectsRef, syncTimerRef,
    dataVersionRef, mutationLockRef, getJwt, lastFreshnessCheckRef, updateCloudMetadata, dispatch,
    lastDeparture,
  } = deps;

  const prevActiveLocalIdRef = useRef<string | null>(null);
  const pendingDepartureSequencesRef = useRef<Set<number>>(new Set());
  const retryTimersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  const activeCloudId = useMemo(
    () => projects.find(p => p.localId === activeLocalId)?.cloudId ?? null,
    [projects, activeLocalId],
  );

  useEffect(() => {
    const prevLocalId = prevActiveLocalIdRef.current;
    prevActiveLocalIdRef.current = activeLocalId;
    if (prevLocalId && prevLocalId !== activeLocalId) {
      // Cancel any pending auto-sync timer from the previous project
      if (syncTimerRef.current) {
        clearTimeout(syncTimerRef.current);
        syncTimerRef.current = null;
      }

      // Reset freshness throttle for new project
      lastFreshnessCheckRef.current = 0;

      const departure = lastDeparture?.localId === prevLocalId ? lastDeparture : null;
      const prevEntry = projectsRef.current.find(p => p.localId === prevLocalId);
      const departingCloudId = departure?.cloudId ?? prevEntry?.cloudId ?? null;
      const departingStorage = departure?.storage ?? prevEntry?.storage ?? 'local';

      if (
        departure?.wasDirty
        && departingStorage === 'cloud'
        && departingCloudId
        && !pendingDepartureSequencesRef.current.has(departure.sequence)
      ) {
        const jwt = getJwt();
        if (jwt) {
          pendingDepartureSequencesRef.current.add(departure.sequence);

          let departureSaveRetries = 0;
          const scheduleRetry = () => {
            if (departureSaveRetries >= MAX_DEPARTURE_SAVE_RETRIES) {
              // Give up — the departing data is already durable in localStorage.
              pendingDepartureSequencesRef.current.delete(departure.sequence);
              return;
            }
            departureSaveRetries++;
            const timer = setTimeout(() => {
              retryTimersRef.current.delete(timer);
              attemptSave();
            }, 250);
            retryTimersRef.current.add(timer);
          };

          const attemptSave = () => {
            void withMutationLock(mutationLockRef, async () => {
              const project = loadProject(prevLocalId);
              if (!project) return;
              if (project.cloudConflictVersion) return;

              try {
                const state = deserializeState(project.state);
                const payload = exportToObject(state);
                const savedStateFingerprint = JSON.stringify(project.state);
                const latestEntry = projectsRef.current.find(p => p.localId === prevLocalId);
                const knownVersion = project.serverVersion ?? latestEntry?.serverVersion ?? departure.serverVersion ?? undefined;
                const serverVersion = positiveVersion(knownVersion) ?? undefined;
                const result = await saveProjectToCloudImpl(payload, departingCloudId, jwt, serverVersion);
                if (result.kind === 'updated' || result.kind === 'created') {
                  const latestProject = loadProject(prevLocalId);
                  const changedDuringSave = !!latestProject &&
                    JSON.stringify(latestProject.state) !== savedStateFingerprint;
                  updateCloudMetadata(prevLocalId, {
                    cloudSavedAt: result.timestamp,
                    serverVersion: result.version,
                    cloudConflictVersion: null,
                    hasUnsyncedChanges: changedDuringSave,
                  });
                } else if (result.kind === 'conflict') {
                  updateCloudMetadata(prevLocalId, {
                    serverVersion: result.serverVersion,
                    cloudConflictVersion: result.serverVersion,
                    hasUnsyncedChanges: true,
                  });
                }
              } catch {
                // Best-effort - data still in localStorage
              }
            }).then((result) => {
              if (!result.executed) {
                scheduleRetry();
              } else {
                pendingDepartureSequencesRef.current.delete(departure.sequence);
              }
            }).catch(() => {
              pendingDepartureSequencesRef.current.delete(departure.sequence);
            });
          };
          attemptSave();
        }
      }
    }

    if (!activeLocalId) {
      if (prevLocalId) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        cloudDispatch({ type: 'LIFECYCLE_RESET' });
        clearCloudUrl();
      }
      return;
    }

    const entry = projectsRef.current.find(p => p.localId === activeLocalId);
    const storedProject = loadProject(activeLocalId);
    const ownedEntry = entry && isOwnedCloudEntry(entry) ? entry : null;
    const ownedProject = storedProject && isOwnedCloudEntry(storedProject) ? storedProject : null;
    const cloudId = ownedEntry?.cloudId ?? ownedProject?.cloudId ?? null;
    if (cloudId === internalRef.current.cloudId) return;

    const storage: 'cloud' | 'local' = cloudId ? 'cloud' : 'local';
    const isOwner = storage === 'cloud';
    if (cloudId === null) {
      cloudDispatch({ type: 'INIT_LOCAL', storage });
      clearCloudUrl();
    } else {
      const conflictVersion = ownedEntry?.cloudConflictVersion ?? ownedProject?.cloudConflictVersion ?? null;
      const serverVersion = normalizeServerVersion(ownedEntry?.serverVersion ?? ownedProject?.serverVersion);
      const hasStoredUnsyncedChanges = (ownedEntry?.hasUnsyncedChanges ?? ownedProject?.hasUnsyncedChanges) === true;
      // Path B of the unified init (S10a / DESIGN §3a): build the flat INIT state
      // via the shared pure `cloudStateForEntry`. The four divergences from Path A
      // (`initFromProject`) are explicit decisions here:
      //   • setCloudUrl — Path B explicitly sets the URL on switch (below).
      //   • lastCloudSavedAt — both paths now thread the manifest's cloudSavedAt
      //     (owned entry, falling back to the stored project).
      //   • baseline seeding — Path B dispatches REQUEST_BASELINE (baseline →
      //     {untracked}) when there are no stored unsynced changes (below); the
      //     dirty case keeps the `dirty` baseline.
      //   • freshness kickoff — Path B kicks off a freshness check (below).
      setCloudUrl(cloudId);
      const next = cloudStateForEntry({
        prev: internalRef.current,
        cloudId,
        isOwner,
        storage,
        shareUrl: buildProjectUrl(cloudId),
        lastCloudSavedAt: ownedEntry?.cloudSavedAt ?? ownedProject?.cloudSavedAt ?? null,
        visibility: ownedEntry?.visibility ?? ownedProject?.visibility ?? 'private',
        serverVersion,
        conflictVersion,
        hasUnsyncedChanges: hasStoredUnsyncedChanges,
        dataVersion: dataVersionRef.current,
      });
      // Synchronous ref write precedes the dispatch (DESIGN §5): the switch-init
      // same-commit guard `cloudId === internalRef.current.cloudId` must see this seed.
      internalRef.current = next;
      cloudDispatch({ type: 'INIT_CLOUD', seed: next });
      // Clean incoming cloud project: mark "awaiting baseline capture" (baseline
      // → {untracked}) so the engine snapshots the current generation into a
      // clean baseline on its next effect tick (replaces
      // `needsVersionSyncRef.current = true`). When stored unsynced changes exist
      // we stay dirty (no capture) — the `dirty` baseline `cloudStateForEntry`
      // seeded above keeps it dirty.
      if (!hasStoredUnsyncedChanges) {
        cloudDispatch({ type: 'REQUEST_BASELINE' });
      }

      // Freshness check for incoming project
      const jwt = getJwt();
      if (jwt && isOwner && !conflictVersion && !hasStoredUnsyncedChanges) {
        const freshnessCtx: FreshnessCheckContext = {
          internalRef, dataVersionRef, dispatch,
          lastFreshnessCheckRef, updateCloudMetadata, cloudDispatch,
        };
        checkAndPullFreshVersion(freshnessCtx, {
          cloudId,
          knownVersion: normalizeServerVersion(serverVersion),
          localId: activeLocalId,
          jwt,
        }).catch((err) => {
          if (import.meta.env.DEV) console.warn('Freshness check failed:', err);
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocalId, activeCloudId, lastDeparture?.sequence]);

  useEffect(() => () => {
    for (const timer of retryTimersRef.current) {
      clearTimeout(timer);
    }
    retryTimersRef.current.clear();
    pendingDepartureSequencesRef.current.clear();
  }, []);
}
