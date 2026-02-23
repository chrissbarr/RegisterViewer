import { useCallback, useMemo, type MutableRefObject, type SetStateAction, type Dispatch } from 'react';
import { exportToObject, deserializeState } from '../utils/storage';
import {
  isCloudEnabled,
  createProject,
  updateProject,
  patchProjectVisibility,
  deleteProject as apiDeleteProject,
} from '../utils/api-client';
import {
  getOrCreateOwnerToken,
  hashOwnerToken,
  getOwnerTokenForProject,
} from '../utils/owner-token';
import { loadManifest, loadProject, buildProjectUrl } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, CLEARED_CLOUD_METADATA } from '../utils/cloud-url';
import type { Visibility } from '../types/project';

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
  activeLocalIdRef: MutableRefObject<string | null>;
  dataVersionRef: MutableRefObject<number>;
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
  const { updateCloudMetadata, activeLocalIdRef, dataVersionRef, internalRef, setInternal, initialInternalState } = deps;

  const saveProjectToCloud = useCallback(async (localId: string) => {
    if (!isCloudEnabled()) return;

    const project = loadProject(localId);
    if (!project) throw new Error('Project not found.');

    const projectState = deserializeState(project.state);
    const jsonPayload = exportToObject(projectState);
    const ownerToken = getOrCreateOwnerToken();
    const tokenHash = await hashOwnerToken(ownerToken);

    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === localId);
    const existingCloudId = entry?.cloudId ?? project.cloudId;

    if (existingCloudId) {
      const existingOwnerToken = getOwnerTokenForProject(existingCloudId);
      if (!existingOwnerToken) throw new Error('Owner token not found.');
      const existingTokenHash = await hashOwnerToken(existingOwnerToken);
      const result = await updateProject(existingCloudId, jsonPayload, existingTokenHash);
      updateCloudMetadata(localId, { cloudSavedAt: result.updatedAt });
    } else {
      const result = await createProject(jsonPayload, tokenHash);
      updateCloudMetadata(localId, {
        cloudId: result.id,
        cloudSavedAt: result.createdAt,
        ownerToken,
      });

      // If this is the active project, update cloud state + URL
      if (localId === activeLocalIdRef.current) {
        setCloudUrl(result.id);
        setInternal((prev) => ({
          ...prev,
          cloudId: result.id,
          isOwner: true,
          shareUrl: buildProjectUrl(result.id),
          lastCloudSavedAt: result.createdAt,
          lastSavedVersion: dataVersionRef.current,
        }));
      }
    }
  }, [updateCloudMetadata, activeLocalIdRef, dataVersionRef, setInternal]);

  const deleteProjectFromCloud = useCallback(async (cloudId: string) => {
    const ownerToken = getOwnerTokenForProject(cloudId);
    if (!ownerToken) throw new Error('Owner token not found.');

    const tokenHash = await hashOwnerToken(ownerToken);
    await apiDeleteProject(cloudId, tokenHash);

    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.cloudId === cloudId);
    if (entry) {
      updateCloudMetadata(entry.localId, CLEARED_CLOUD_METADATA);
    }

    // If the currently active cloud project is this one, clear cloud state
    if (internalRef.current.cloudId === cloudId) {
      clearCloudUrl();
      setInternal({ ...initialInternalState });
    }
  }, [updateCloudMetadata, internalRef, setInternal, initialInternalState]);

  const setProjectVisibility = useCallback(async (localId: string, v: Visibility) => {
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === localId);
    if (!entry?.cloudId) return;

    const ownerToken = getOwnerTokenForProject(entry.cloudId);
    if (!ownerToken) return;

    try {
      const tokenHash = await hashOwnerToken(ownerToken);
      await patchProjectVisibility(entry.cloudId, v, tokenHash);

      updateCloudMetadata(localId, { visibility: v });

      // If this is the active project, update cloud state too
      if (localId === activeLocalIdRef.current) {
        setInternal((prev) => ({ ...prev, visibility: v }));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update visibility.';
      throw new Error(message);
    }
  }, [updateCloudMetadata, activeLocalIdRef, setInternal]);

  const unlinkCloudProject = useCallback((localId: string) => {
    const manifest = loadManifest();
    const entry = manifest.projects.find(p => p.localId === localId);
    if (!entry || !entry.cloudId) return;

    const cloudId = entry.cloudId;
    updateCloudMetadata(localId, CLEARED_CLOUD_METADATA);

    // If the currently active cloud project is this one, clear cloud state
    if (internalRef.current.cloudId === cloudId) {
      clearCloudUrl();
      setInternal({ ...initialInternalState });
    }
  }, [updateCloudMetadata, internalRef, setInternal, initialInternalState]);

  return useMemo(
    () => ({ saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject }),
    [saveProjectToCloud, deleteProjectFromCloud, setProjectVisibility, unlinkCloudProject],
  );
}
