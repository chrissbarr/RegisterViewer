import { useState, useCallback, useEffect } from 'react';
import { useProjectStorage, useProjectStorageActions } from '../context/project-storage-context';
import { useCloudSyncActions } from '../context/cloud-sync-context';
import { useAnnounce } from '../components/common/announcer';
import { isCloudEnabled } from '../utils/api-client';
import { getOrCreateOwnerToken } from '../utils/owner-token';
import type { Visibility } from '../types/project';

interface CloudDeleteConfirm {
  localId: string;
  cloudId: string;
  name: string;
}

export function useMyProjectsActions(
  open: boolean,
  onClose: () => void,
  onShareProject?: (localId: string) => void,
  onBeforeNewProject?: () => void,
) {
  const { projects } = useProjectStorage();
  const { createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList } = useProjectStorageActions();
  const { setProjectVisibility, syncCloudProjects, deleteProjectFromCloud, unlinkCloudProject, saveProjectToCloud } = useCloudSyncActions();
  const announce = useAnnounce();

  const [staleCloudIds, setStaleCloudIds] = useState<string[]>([]);
  const [deleteCloudConfirm, setDeleteCloudConfirm] = useState<CloudDeleteConfirm | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [saveToCloudLocalId, setSaveToCloudLocalId] = useState<string | null>(null);

  // Refresh project list and sync with cloud when dialog opens;
  // cleanup clears stale IDs when dialog closes.
  useEffect(() => {
    if (!open) return;
    refreshProjectList();
    if (isCloudEnabled()) {
      syncCloudProjects().then((result) => {
        setStaleCloudIds(result.staleCloudIds);
        if (result.updatedCount > 0 || result.staleCloudIds.length > 0) {
          refreshProjectList();
        }
      }).catch(() => {
        // Best-effort background sync — swallow network errors
      });
    }
    return () => setStaleCloudIds([]);
  }, [open, refreshProjectList, syncCloudProjects]);

  const handleNewProject = useCallback(() => {
    const localId = createNewProject();
    switchProject(localId);
    announce('New project created');
    onBeforeNewProject?.();
    onClose();
  }, [createNewProject, switchProject, announce, onBeforeNewProject, onClose]);

  const handleOpen = useCallback((localId: string) => {
    switchProject(localId);
    announce('Project opened');
    onClose();
  }, [switchProject, announce, onClose]);

  const handleDelete = useCallback((localId: string) => {
    const project = projects.find(p => p.localId === localId);
    deleteLocalProject(localId);
    announce(`Project "${project?.name || 'Untitled Project'}" deleted`);
  }, [deleteLocalProject, announce, projects]);

  const handleRename = useCallback((localId: string, name: string) => {
    renameProject(localId, name);
    announce(`Project renamed to "${name}"`);
  }, [renameProject, announce]);

  const handleShare = useCallback((localId: string) => {
    onShareProject?.(localId);
  }, [onShareProject]);

  const handleChangeVisibility = useCallback(async (localId: string, v: Visibility) => {
    try {
      await setProjectVisibility(localId, v);
      announce(`Visibility changed to ${v}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to change visibility.';
      setCloudError(message);
    }
  }, [setProjectVisibility, announce]);

  const handleSaveToCloud = useCallback((localId: string) => {
    setSaveToCloudLocalId(localId);
  }, []);

  const handleConfirmSaveToCloud = useCallback(async () => {
    const localId = saveToCloudLocalId;
    setSaveToCloudLocalId(null);
    if (!localId) return;
    try {
      await saveProjectToCloud(localId);
      announce('Saved to cloud');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save to cloud.';
      setCloudError(message);
    }
  }, [saveToCloudLocalId, saveProjectToCloud, announce]);

  const handleRemoveFromCloud = useCallback((localId: string) => {
    const project = projects.find(p => p.localId === localId);
    if (project?.isCloudSaved && project.cloudId) {
      setDeleteCloudConfirm({
        localId,
        cloudId: project.cloudId,
        name: project.name || 'Untitled Project',
      });
    }
  }, [projects]);

  const handleConfirmCloudDelete = useCallback(async () => {
    if (!deleteCloudConfirm) return;
    try {
      await deleteProjectFromCloud(deleteCloudConfirm.cloudId);
      refreshProjectList();
      announce('Removed from cloud');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete from cloud.';
      setCloudError(message);
    }
    setDeleteCloudConfirm(null);
  }, [deleteCloudConfirm, deleteProjectFromCloud, refreshProjectList, announce]);

  const handleUnlinkCloud = useCallback((localId: string) => {
    unlinkCloudProject(localId);
    setStaleCloudIds((prev) => {
      const project = projects.find(p => p.localId === localId);
      if (project?.cloudId) {
        return prev.filter(id => id !== project.cloudId);
      }
      return prev;
    });
    refreshProjectList();
    announce('Cloud link removed');
  }, [unlinkCloudProject, refreshProjectList, announce, projects]);

  const handleDownloadRecoveryKey = useCallback(() => {
    try {
      const token = getOrCreateOwnerToken();
      if (!token) {
        announce('No recovery key found', { politeness: 'assertive' });
        return;
      }

      const data = {
        type: 'register-viewer-recovery-key',
        version: 1,
        ownerToken: token,
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'register-viewer-recovery-key.json';
      a.click();
      URL.revokeObjectURL(url);
      announce('Recovery key downloaded');
    } catch {
      announce('Failed to download recovery key', { politeness: 'assertive' });
    }
  }, [announce]);

  const dismissCloudError = useCallback(() => setCloudError(null), []);
  const dismissSaveToCloud = useCallback(() => setSaveToCloudLocalId(null), []);
  const dismissDeleteCloudConfirm = useCallback(() => setDeleteCloudConfirm(null), []);

  return {
    // Item actions
    handleNewProject,
    handleOpen,
    handleDelete,
    handleRename,
    handleShare,
    handleChangeVisibility,
    handleSaveToCloud,
    handleRemoveFromCloud,
    handleUnlinkCloud,
    handleDownloadRecoveryKey,

    // Cloud confirmation state + actions
    handleConfirmSaveToCloud,
    handleConfirmCloudDelete,
    isSaveToCloudOpen: saveToCloudLocalId !== null,
    isDeleteCloudConfirmOpen: deleteCloudConfirm !== null,
    cloudError,
    staleCloudIds,
    dismissCloudError,
    dismissSaveToCloud,
    dismissDeleteCloudConfirm,
  } as const;
}
