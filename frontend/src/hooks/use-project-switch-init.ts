import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { buildProjectUrl, loadProject } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl } from '../utils/cloud-utils';
import { exportToObject, deserializeState } from '../utils/storage';
import { saveProjectToCloudImpl } from '../utils/cloud-operations';
import { type CloudSyncCore, initialInternalState } from '../types/cloud-sync';
import type { CloudMetadataUpdate } from '../types/cloud-sync';
import type { ProjectListEntry } from '../types/project';

interface UseProjectSwitchInitDeps {
  core: CloudSyncCore;
  activeLocalId: string | null;
  projects: ProjectListEntry[];
  projectsRef: MutableRefObject<ProjectListEntry[]>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  dataVersionRef: MutableRefObject<number>;
  getJwt: () => string | null;
  lastFreshnessCheckRef: MutableRefObject<number>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => void;
}

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
 * localStorage data — cloud projects stay cached locally.
 */
export function useProjectSwitchInit(deps: UseProjectSwitchInitDeps): void {
  const {
    core: { internalRef, activeLocalIdRef: _activeLocalIdRef, setInternal },
    activeLocalId, projects,
    projectsRef, needsVersionSyncRef, syncTimerRef,
    dataVersionRef, getJwt, lastFreshnessCheckRef, updateCloudMetadata,
  } = deps;

  const prevActiveLocalIdRef = useRef<string | null>(null);

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

      // Best-effort save for departing project (fire-and-forget)
      const prevEntry = projectsRef.current.find(p => p.localId === prevLocalId);
      if (prevEntry?.storage === 'cloud' && prevEntry.cloudId && prevEntry.serverVersion) {
        const jwt = getJwt();
        if (jwt) {
          const isDirty = dataVersionRef.current !== internalRef.current.lastSavedVersion;
          if (isDirty) {
            const project = loadProject(prevLocalId);
            if (project) {
              try {
                const state = deserializeState(project.state);
                const payload = exportToObject(state);
                saveProjectToCloudImpl(payload, prevEntry.cloudId, jwt, prevEntry.serverVersion)
                  .then((result) => {
                    if (result.kind === 'updated' || result.kind === 'created') {
                      updateCloudMetadata(prevLocalId, {
                        cloudSavedAt: result.timestamp,
                        serverVersion: result.version,
                      });
                    }
                  })
                  .catch(() => { /* best-effort — data still in localStorage */ });
              } catch {
                // deserializeState failed — data still in localStorage
              }
            }
          }
        }
      }
    }

    if (!activeLocalId) {
      if (prevLocalId) {
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        setInternal(initialInternalState);
        clearCloudUrl();
      }
      return;
    }

    const entry = projectsRef.current.find(p => p.localId === activeLocalId);
    const cloudId = entry?.cloudId ?? null;
    if (cloudId === internalRef.current.cloudId) return;

    const isOwner = entry?.storage === 'cloud';
    if (cloudId === null) {
      setInternal(initialInternalState);
      clearCloudUrl();
    } else {
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
        serverVersion: entry?.serverVersion ?? 0,
        conflict: null,
      }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocalId, activeCloudId]);
}
