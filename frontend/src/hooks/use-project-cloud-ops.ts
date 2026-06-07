import { useCallback, useMemo, type MutableRefObject } from 'react';
import { exportToObject, deserializeState } from '../utils/storage';
import { isCloudEnabled } from '../utils/api-client';
import { loadProject, type ProjectStorageWriteResult } from '../utils/project-storage';
import { clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock, requireJwt } from '../utils/cloud-utils';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import type { Visibility, ProjectListEntry } from '../types/project';
import { type CloudSyncCore, type CloudMetadataUpdate, type SaveOutcome, initialInternalState } from '../types/cloud-sync';
import { isOwnedCloudEntry } from '../utils/project-identity';

interface ProjectCloudOpsDeps {
  core: CloudSyncCore;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  projectsRef: MutableRefObject<ProjectListEntry[]>;
  mutationLockRef: MutableRefObject<boolean>;
  getJwt: () => string | null;
  /** Save the active project using live React state (handles dirty tracking + status). */
  activeProjectSave: () => Promise<SaveOutcome>;
}

interface ProjectCloudOps {
  saveProjectToCloud: (localId: string) => Promise<void>;
  deleteProjectFromCloud: (localId: string) => Promise<void>;
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
      const outcome = await activeProjectSave();
      if (outcome !== 'saved' && outcome !== 'created' && outcome !== 'noop') {
        throw new Error('Failed to save active project to cloud.');
      }
      return;
    }

    // Non-active project: read from localStorage
    const lockResult = await withMutationLock(mutationLockRef, async () => {
      const project = loadProject(localId);
      if (!project) throw new Error('Project not found.');

      const projectState = deserializeState(project.state);
      const jsonPayload = exportToObject(projectState);

      const entry = projectsRef.current.find(p => p.localId === localId);
      const ownedEntry = entry && isOwnedCloudEntry(entry) ? entry : null;
      const ownedProject = isOwnedCloudEntry(project) ? project : null;
      const existingCloudId = ownedEntry?.cloudId ?? ownedProject?.cloudId ?? null;
      const knownServerVersion = ownedEntry?.serverVersion ?? ownedProject?.serverVersion ?? undefined;
      const serverVersion = typeof knownServerVersion === 'number' && knownServerVersion > 0
        ? knownServerVersion
        : undefined;

      const jwt = requireJwt(getJwt);
      const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, jwt, serverVersion);

      if (result.kind === 'not-found') {
        throw new Error('Cloud project not found on server.');
      }

      if (result.kind === 'conflict') {
        throw new Error('Server version conflict. Please try again.');
      }

      if (result.kind === 'created') {
        const metadataResult = updateCloudMetadata(localId, {
          cloudId: result.cloudId,
          cloudSavedAt: result.timestamp,
          storage: 'cloud',
          serverVersion: result.version,
          cloudConflictVersion: null,
          hasUnsyncedChanges: false,
        });
        if (!metadataResult.ok) throw new Error('Saved to cloud, but failed to persist local cloud metadata.');
      } else {
        const metadataResult = updateCloudMetadata(localId, {
          cloudSavedAt: result.timestamp,
          storage: 'cloud',
          serverVersion: result.version,
          cloudConflictVersion: null,
          hasUnsyncedChanges: false,
        });
        if (!metadataResult.ok) throw new Error('Saved to cloud, but failed to persist local cloud metadata.');
      }
    });
    if (!lockResult.executed) {
      throw new Error('Another cloud operation is in progress. Please try again.');
    }
  }, [updateCloudMetadata, projectsRef, mutationLockRef, activeLocalIdRef, getJwt, activeProjectSave]);

  const deleteProjectFromCloud = useCallback(async (localId: string) => {
    await withMutationLock(mutationLockRef, async () => {
      const entry = projectsRef.current.find(p => p.localId === localId);
      if (!entry || !isOwnedCloudEntry(entry)) return;

      const cloudId = entry.cloudId;
      const jwt = requireJwt(getJwt);
      await deleteProjectFromCloudImpl(cloudId, jwt);

      const metadataResult = updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);
      if (!metadataResult.ok) throw new Error('Deleted cloud project, but failed to persist local metadata.');

      // If the currently active cloud project is this one, clear cloud state
      if (internalRef.current.cloudId === cloudId) {
        clearCloudUrl();
        setInternal(initialInternalState);
      }
    });
  }, [updateCloudMetadata, projectsRef, mutationLockRef, internalRef, setInternal, getJwt]);

  const setProjectVisibility = useCallback(async (localId: string, v: Visibility) => {
    const entry = projectsRef.current.find(p => p.localId === localId);
    if (!entry || !isOwnedCloudEntry(entry)) return;

    const jwt = requireJwt(getJwt);
    await patchVisibilityImpl(entry.cloudId, v, jwt);

    const metadataResult = updateCloudMetadata(localId, { visibility: v });
    if (!metadataResult.ok) throw new Error('Visibility changed on server, but failed to persist local metadata.');

    // If this is the active project, update cloud state too
    if (localId === activeLocalIdRef.current) {
      setInternal((prev) => ({ ...prev, visibility: v }));
    }
  }, [updateCloudMetadata, projectsRef, activeLocalIdRef, setInternal, getJwt]);

  const unlinkCloudProject = useCallback((localId: string) => {
    const entry = projectsRef.current.find(p => p.localId === localId);
    if (!entry || !isOwnedCloudEntry(entry)) return;

    const cloudId = entry.cloudId;
    const metadataResult = updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);
    if (!metadataResult.ok) return;

    // If the currently active cloud project is this one, clear cloud state
    if (internalRef.current.cloudId === cloudId) {
      clearCloudUrl();
      setInternal(initialInternalState);
    }
  }, [updateCloudMetadata, projectsRef, internalRef, setInternal]);

  return useMemo(
    () => ({ saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject }),
    [saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject],
  );
}
