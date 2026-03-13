import { useCallback, useMemo, type MutableRefObject } from 'react';
import { exportToObject, deserializeState } from '../utils/storage';
import { isCloudEnabled } from '../utils/api-client';
import { loadProject } from '../utils/project-storage';
import { clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock, requireJwt } from '../utils/cloud-url';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import type { Visibility, ProjectListEntry } from '../types/project';
import { type CloudSyncCore, initialInternalState } from '../types/cloud-sync';

interface ProjectCloudOpsDeps {
  core: CloudSyncCore;
  updateCloudMetadata: (localId: string, updates: Partial<{
    cloudId: string | null;
    cloudSavedAt: string | null;
    visibility: Visibility;
    storage: 'local' | 'cloud';
  }>) => void;
  projectsRef: MutableRefObject<ProjectListEntry[]>;
  mutationLockRef: MutableRefObject<boolean>;
  getJwt: () => string | null;
  /** Save the active project using live React state (handles dirty tracking + status). */
  activeProjectSave: () => Promise<boolean>;
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
export function useProjectCloudOps(deps: ProjectCloudOpsDeps): ProjectCloudOps {
  const { core: { internalRef, activeLocalIdRef, setInternal }, updateCloudMetadata, projectsRef, mutationLockRef, getJwt, activeProjectSave } = deps;

  const saveProjectToCloud = useCallback(async (localId: string) => {
    if (!isCloudEnabled()) return;

    // Active project: delegate to the live-state path which handles
    // dirty tracking, status indicators, and reads fresh React state.
    if (localId === activeLocalIdRef.current) {
      await activeProjectSave();
      return;
    }

    // Non-active project: read from localStorage
    const lockResult = await withMutationLock(mutationLockRef, async () => {
      const project = loadProject(localId);
      if (!project) throw new Error('Project not found.');

      const projectState = deserializeState(project.state);
      const jsonPayload = exportToObject(projectState);

      const entry = projectsRef.current.find(p => p.localId === localId);
      const existingCloudId = entry?.cloudId ?? project.cloudId;

      const jwt = requireJwt(getJwt);
      const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, jwt);

      if (result.kind === 'not-found') {
        throw new Error('Cloud project not found on server.');
      }

      if (result.kind === 'created') {
        updateCloudMetadata(localId, {
          cloudId: result.cloudId,
          cloudSavedAt: result.timestamp,
          storage: 'cloud',
        });
      } else {
        updateCloudMetadata(localId, { cloudSavedAt: result.timestamp, storage: 'cloud' });
      }
    });
    if (!lockResult.executed) {
      throw new Error('Another cloud operation is in progress. Please try again.');
    }
  }, [updateCloudMetadata, projectsRef, mutationLockRef, activeLocalIdRef, getJwt, activeProjectSave]);

  const deleteProjectFromCloud = useCallback(async (cloudId: string) => {
    await withMutationLock(mutationLockRef, async () => {
      const jwt = requireJwt(getJwt);
      await deleteProjectFromCloudImpl(cloudId, jwt);

      const entry = projectsRef.current.find(p => p.cloudId === cloudId);
      if (entry) {
        updateCloudMetadata(entry.localId, CLEARED_CLOUD_METADATA);
      }

      // If the currently active cloud project is this one, clear cloud state
      if (internalRef.current.cloudId === cloudId) {
        clearCloudUrl();
        setInternal({ ...initialInternalState });
      }
    });
  }, [updateCloudMetadata, projectsRef, mutationLockRef, internalRef, setInternal, getJwt]);

  const setProjectVisibility = useCallback(async (localId: string, v: Visibility) => {
    const entry = projectsRef.current.find(p => p.localId === localId);
    if (!entry?.cloudId) return;

    const jwt = requireJwt(getJwt);
    await patchVisibilityImpl(entry.cloudId, v, jwt);

    updateCloudMetadata(localId, { visibility: v });

    // If this is the active project, update cloud state too
    if (localId === activeLocalIdRef.current) {
      setInternal((prev) => ({ ...prev, visibility: v }));
    }
  }, [updateCloudMetadata, projectsRef, activeLocalIdRef, setInternal, getJwt]);

  const unlinkCloudProject = useCallback((localId: string) => {
    const entry = projectsRef.current.find(p => p.localId === localId);
    if (!entry || !entry.cloudId) return;

    const cloudId = entry.cloudId;
    updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);

    // If the currently active cloud project is this one, clear cloud state
    if (internalRef.current.cloudId === cloudId) {
      clearCloudUrl();
      setInternal({ ...initialInternalState });
    }
  }, [updateCloudMetadata, projectsRef, internalRef, setInternal]);

  return useMemo(
    () => ({ saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject }),
    [saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject],
  );
}
