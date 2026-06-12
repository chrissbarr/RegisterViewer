import { useCallback, useMemo, type MutableRefObject } from 'react';
import { exportToObject, deserializeState } from '../utils/storage';
import { isCloudEnabled, ApiError } from '../utils/api-client';
import { loadProject, type ProjectStorageWriteResult } from '../utils/project-storage';
import { clearCloudUrl, CLEARED_CLOUD_METADATA, CONFLICT_PENDING_MESSAGE, SESSION_EXPIRED_MESSAGE, withMutationLock, requireJwt, applyVisibilityWrite } from '../utils/cloud-utils';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import { positiveVersion } from '../utils/cloud-sync';
import type { Visibility, ProjectListEntry } from '../types/project';
import { type CloudSyncCore, type CloudMetadataUpdate, type SaveOutcome, isSaveSuccess } from '../types/cloud-sync';
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
  const { core: { internalRef, activeLocalIdRef, dispatch: cloudDispatch }, updateCloudMetadata, projectsRef, mutationLockRef, getJwt, activeProjectSave } = deps;

  const saveProjectToCloud = useCallback(async (localId: string) => {
    if (!isCloudEnabled()) return;

    // Active project: delegate to the live-state path which handles
    // dirty tracking, status indicators, and reads fresh React state.
    if (localId === activeLocalIdRef.current) {
      const outcome = await activeProjectSave();
      if (outcome === 'conflict-pending') {
        throw new Error(CONFLICT_PENDING_MESSAGE);
      }
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

      // Conflict guard (BR-1): the manifest serverVersion was advanced to the
      // server's version at conflict time, so an unguarded PUT would succeed
      // (silent overwrite) and the success path would write
      // `cloudConflictVersion: null` — erasing the evidence purgeCloudProjects
      // needs to demote (not evict) the entry. Refuse with NO network call and
      // NO metadata write.
      if ((ownedEntry?.cloudConflictVersion ?? ownedProject?.cloudConflictVersion) != null) {
        throw new Error(CONFLICT_PENDING_MESSAGE);
      }

      const existingCloudId = ownedEntry?.cloudId ?? ownedProject?.cloudId ?? null;
      const knownServerVersion = ownedEntry?.serverVersion ?? ownedProject?.serverVersion ?? undefined;
      const serverVersion = positiveVersion(knownServerVersion) ?? undefined;

      const jwt = requireJwt(getJwt);
      const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, jwt, serverVersion);

      if (result.kind === 'auth-stale') {
        // BR-6: dead token on the probe path — the uniform 404s proved nothing
        // about the project, so fail WITHOUT any metadata write: the cloud
        // link must survive a stale session.
        throw new Error(SESSION_EXPIRED_MESSAGE);
      }

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

      // If the currently active cloud project is this one, clear cloud state
      // (LIFECYCLE_RESET returns the frozen initial state, same as the former
      // value-form reset).
      if (internalRef.current.cloudId === cloudId) {
        clearCloudUrl();
        cloudDispatch({ type: 'LIFECYCLE_RESET' });
      }
    });
    if (!lockResult.executed) {
      throw new Error('Another cloud operation is in progress. Please try again.');
    }
  }, [updateCloudMetadata, projectsRef, mutationLockRef, internalRef, cloudDispatch, getJwt]);

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
      cloudDispatch({ type: 'SET_VISIBILITY', visibility: v, cloudSavedAt: updatedAt });
    }
  }, [updateCloudMetadata, projectsRef, activeLocalIdRef, cloudDispatch, getJwt]);

  const unlinkCloudProject = useCallback((localId: string) => {
    const entry = projectsRef.current.find(p => p.localId === localId);
    if (!entry || !isOwnedCloudEntry(entry)) return;

    const cloudId = entry.cloudId;
    const metadataResult = updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);
    if (!metadataResult.ok) return;

    // If the currently active cloud project is this one, clear cloud state
    // (LIFECYCLE_RESET returns the frozen initial state, same as the former
    // value-form reset).
    if (internalRef.current.cloudId === cloudId) {
      clearCloudUrl();
      cloudDispatch({ type: 'LIFECYCLE_RESET' });
    }
  }, [updateCloudMetadata, projectsRef, internalRef, cloudDispatch]);

  return useMemo(
    () => ({ saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject }),
    [saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject],
  );
}
