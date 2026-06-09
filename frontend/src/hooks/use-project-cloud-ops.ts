import { useCallback, useMemo, type MutableRefObject } from 'react';
import { exportToObject, deserializeState } from '../utils/storage';
import { isCloudEnabled, ApiError } from '../utils/api-client';
import { loadProject, type ProjectStorageWriteResult } from '../utils/project-storage';
import { clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock, requireJwt, applyVisibilityWrite } from '../utils/cloud-utils';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import { positiveVersion } from '../utils/cloud-sync';
import { cloudSyncReducer } from '../utils/cloud-sync-reducer';
import type { Visibility, ProjectListEntry } from '../types/project';
import { type CloudSyncCore, type CloudMetadataUpdate, type SaveOutcome, isSaveSuccess, initialInternalState } from '../types/cloud-sync';
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
      if (!isSaveSuccess(outcome)) {
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
      const serverVersion = positiveVersion(knownServerVersion) ?? undefined;

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
    const lockResult = await withMutationLock(mutationLockRef, async () => {
      const entry = projectsRef.current.find(p => p.localId === localId);
      if (!entry || !isOwnedCloudEntry(entry)) return;

      const cloudId = entry.cloudId;
      const jwt = requireJwt(getJwt);
      try {
        await deleteProjectFromCloudImpl(cloudId, jwt);
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
        // 404 = server copy already gone; fall through to clear local metadata.
      }

      const metadataResult = updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);
      if (!metadataResult.ok) throw new Error('Deleted cloud project, but failed to persist local metadata.');

      // If the currently active cloud project is this one, clear cloud state.
      // Left as a value-form raw reset (NOT a LIFECYCLE_RESET functional updater):
      // the by-localId tests pin `setInternal` being called with the reset OBJECT,
      // matching the S5 precedent at use-active-project-cloud-ops.ts (deleteFromCloud).
      if (internalRef.current.cloudId === cloudId) {
        clearCloudUrl();
        setInternal(initialInternalState);
      }
    });
    if (!lockResult.executed) {
      throw new Error('Another cloud operation is in progress. Please try again.');
    }
  }, [updateCloudMetadata, projectsRef, mutationLockRef, internalRef, setInternal, getJwt]);

  const setProjectVisibility = useCallback(async (localId: string, v: Visibility) => {
    const entry = projectsRef.current.find(p => p.localId === localId);
    if (!entry || !isOwnedCloudEntry(entry)) return;

    const jwt = requireJwt(getJwt);
    // A visibility PATCH advances the server's updated_at without bumping version;
    // persist the returned updatedAt so local cloudSavedAt tracks it immediately
    // rather than waiting for the next LIST sync (A-9 parity with the active path).
    const updatedAt = await patchVisibilityImpl(entry.cloudId, v, jwt);

    const metadataResult = applyVisibilityWrite(updateCloudMetadata, localId, v, updatedAt);
    if (!metadataResult.ok) throw new Error('Visibility changed on server, but failed to persist local metadata.');

    // If this is the active project, update cloud state too (mirror the advanced
    // cloudSavedAt so the active state tracks it).
    if (localId === activeLocalIdRef.current) {
      setInternal((prev) => cloudSyncReducer(prev, { type: 'SET_VISIBILITY', visibility: v, cloudSavedAt: updatedAt }));
    }
  }, [updateCloudMetadata, projectsRef, activeLocalIdRef, setInternal, getJwt]);

  const unlinkCloudProject = useCallback((localId: string) => {
    const entry = projectsRef.current.find(p => p.localId === localId);
    if (!entry || !isOwnedCloudEntry(entry)) return;

    const cloudId = entry.cloudId;
    const metadataResult = updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);
    if (!metadataResult.ok) return;

    // If the currently active cloud project is this one, clear cloud state.
    // Value-form raw reset (see deleteProjectFromCloud above): the by-localId test
    // pins `setInternal` being called with the reset OBJECT, so a LIFECYCLE_RESET
    // functional updater would change the assertion. Matches the S5 active-ops precedent.
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
