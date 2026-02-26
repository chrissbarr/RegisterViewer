import { useCallback, useMemo, type MutableRefObject, type SetStateAction, type Dispatch } from 'react';
import { exportToObject, deserializeState } from '../utils/storage';
import { isCloudEnabled } from '../utils/api-client';
import { loadProject, buildProjectUrl } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock } from '../utils/cloud-url';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import type { Visibility, ProjectListEntry } from '../types/project';

/** Minimal slice of internal cloud-sync state needed by project operations. */
interface CloudSyncInternalSlice {
  cloudId: string | null;
  isOwner: boolean;
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastCloudSavedAt: string | null;
  lastSavedVersion: number;
  visibility: Visibility;
}

interface ProjectCloudOpsDeps<T extends CloudSyncInternalSlice> {
  updateCloudMetadata: (localId: string, updates: Partial<{
    cloudId: string | null;
    cloudSavedAt: string | null;
    visibility: Visibility;
    ownerToken: string | null;
  }>) => void;
  projects: ProjectListEntry[];
  activeLocalIdRef: MutableRefObject<string | null>;
  dataVersionRef: MutableRefObject<number>;
  mutationLockRef: MutableRefObject<boolean>;
  internalRef: MutableRefObject<T>;
  setInternal: Dispatch<SetStateAction<T>>;
  initialInternalState: T;
}

interface ProjectCloudOps {
  saveProjectToCloud: (localId: string) => Promise<void>;
  deleteProjectFromCloud: (cloudId: string) => Promise<void>;
  setProjectVisibility: (localId: string, v: Visibility) => Promise<void>;
  unlinkCloudProject: (localId: string) => void;
}

/**
 * Cloud operations that target a specific project by localId or cloudId,
 * without depending on the currently active project's app state.
 * Used primarily by the My Projects dialog.
 */
export function useProjectCloudOps<T extends CloudSyncInternalSlice>(deps: ProjectCloudOpsDeps<T>): ProjectCloudOps {
  const { updateCloudMetadata, projects, activeLocalIdRef, dataVersionRef, mutationLockRef, internalRef, setInternal, initialInternalState } = deps;

  const saveProjectToCloud = useCallback(async (localId: string) => {
    if (!isCloudEnabled()) return;
    await withMutationLock(mutationLockRef, async () => {
      const project = loadProject(localId);
      if (!project) throw new Error('Project not found.');

      const projectState = deserializeState(project.state);
      const jsonPayload = exportToObject(projectState);

      const entry = projects.find(p => p.localId === localId);
      const existingCloudId = entry?.cloudId ?? project.cloudId;

      const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId);

      if (result.kind === 'not-found') {
        throw new Error('Cloud project not found on server.');
      }

      if (result.kind === 'created') {
        updateCloudMetadata(localId, {
          cloudId: result.cloudId,
          cloudSavedAt: result.timestamp,
          ownerToken: result.ownerToken,
        });

        // If this is the active project, update cloud state + URL
        if (localId === activeLocalIdRef.current) {
          setCloudUrl(result.cloudId);
          setInternal((prev) => ({
            ...prev,
            cloudId: result.cloudId,
            isOwner: true,
            shareUrl: buildProjectUrl(result.cloudId),
            lastCloudSavedAt: result.timestamp,
            lastSavedVersion: dataVersionRef.current,
          }));
        }
      } else {
        updateCloudMetadata(localId, { cloudSavedAt: result.timestamp });
      }
    });
  }, [updateCloudMetadata, projects, mutationLockRef, activeLocalIdRef, dataVersionRef, setInternal]);

  const deleteProjectFromCloud = useCallback(async (cloudId: string) => {
    await withMutationLock(mutationLockRef, async () => {
      await deleteProjectFromCloudImpl(cloudId);

      const entry = projects.find(p => p.cloudId === cloudId);
      if (entry) {
        updateCloudMetadata(entry.localId, CLEARED_CLOUD_METADATA);
      }

      // If the currently active cloud project is this one, clear cloud state
      if (internalRef.current.cloudId === cloudId) {
        clearCloudUrl();
        setInternal({ ...initialInternalState });
      }
    });
  }, [updateCloudMetadata, projects, mutationLockRef, internalRef, setInternal, initialInternalState]);

  const setProjectVisibility = useCallback(async (localId: string, v: Visibility) => {
    const entry = projects.find(p => p.localId === localId);
    if (!entry?.cloudId) return;

    await patchVisibilityImpl(entry.cloudId, v);

    updateCloudMetadata(localId, { visibility: v });

    // If this is the active project, update cloud state too
    if (localId === activeLocalIdRef.current) {
      setInternal((prev) => ({ ...prev, visibility: v }));
    }
  }, [updateCloudMetadata, projects, activeLocalIdRef, setInternal]);

  const unlinkCloudProject = useCallback((localId: string) => {
    const entry = projects.find(p => p.localId === localId);
    if (!entry || !entry.cloudId) return;

    const cloudId = entry.cloudId;
    updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);

    // If the currently active cloud project is this one, clear cloud state
    if (internalRef.current.cloudId === cloudId) {
      clearCloudUrl();
      setInternal({ ...initialInternalState });
    }
  }, [updateCloudMetadata, projects, internalRef, setInternal, initialInternalState]);

  return useMemo(
    () => ({ saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject }),
    [saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject],
  );
}
