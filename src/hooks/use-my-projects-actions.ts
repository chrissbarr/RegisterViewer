import { useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStorage, useProjectStorageActions } from '../context/project-storage-context';
import { useAppDispatch } from '../context/app-context';
import { useCloudSyncActions } from '../context/cloud-sync-context';
import { useAnnounce } from '../components/common/announcer';
import { isCloudEnabled } from '../utils/api-client';
import { getOrCreateOwnerToken } from '../utils/owner-token';
import { triggerFileDownload } from '../utils/file-download';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { loadProject, saveProject } from '../utils/project-storage';
import { sanitizeProjectMetadata } from '../utils/storage';
import type { ProjectSettingsData } from '../components/common/project-settings-dialog';
import type { Visibility } from '../types/project';
import { projectDisplayName } from '../utils/project-helpers';

interface CloudDeleteConfirm {
  localId: string;
  cloudId: string;
  name: string;
}

export function useMyProjectsActions(
  open: boolean,
  onClose: () => void,
  onBeforeNewProject?: () => void,
) {
  const { activeLocalId, projects } = useProjectStorage();
  const { createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList } = useProjectStorageActions();
  const { setProjectVisibility, syncCloudProjects, deleteProjectFromCloud, unlinkCloudProject, saveProjectToCloud } = useCloudSyncActions();
  const announce = useAnnounce();

  const dispatch = useAppDispatch();

  const [staleCloudIds, setStaleCloudIds] = useState<string[]>([]);
  const [deleteCloudConfirm, setDeleteCloudConfirm] = useState<CloudDeleteConfirm | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [saveToCloudLocalId, setSaveToCloudLocalId] = useState<string | null>(null);
  const [settingsLocalId, setSettingsLocalId] = useState<string | null>(null);
  const [shareLocalId, setShareLocalId] = useState<string | null>(null);

  // Refresh project list and sync with cloud when dialog opens;
  // cleanup clears stale IDs when dialog closes.
  useEffect(() => {
    if (!open) return;
    refreshProjectList();
    if (isCloudEnabled()) {
      syncCloudProjects().then((result) => {
        setStaleCloudIds(result.staleCloudIds);
      }).catch((err) => {
        setCloudError(friendlyErrorMessage(err, 'Failed to sync cloud projects.'));
      });
    }
    return () => {
      setStaleCloudIds([]);
      setSettingsLocalId(null);
      setShareLocalId(null);
    };
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
    announce(`Project "${projectDisplayName(project?.name)}" deleted`);
  }, [deleteLocalProject, announce, projects]);

  const handleRename = useCallback((localId: string, name: string) => {
    renameProject(localId, name);
    announce(`Project renamed to "${name}"`);
  }, [renameProject, announce]);

  const handleShare = useCallback((localId: string) => {
    setShareLocalId(localId);
  }, []);

  const handleChangeVisibility = useCallback(async (localId: string, v: Visibility) => {
    try {
      await setProjectVisibility(localId, v);
      announce(`Visibility changed to ${v}`);
    } catch (err) {
      setCloudError(friendlyErrorMessage(err, 'Failed to change visibility.'));
    }
  }, [setProjectVisibility, announce]);

  const handleSaveToCloud = useCallback((localId: string) => {
    setSaveToCloudLocalId(localId);
  }, []);

  const [savingCloudLocalId, setSavingCloudLocalId] = useState<string | null>(null);

  const handleConfirmSaveToCloud = useCallback(async () => {
    const localId = saveToCloudLocalId;
    setSaveToCloudLocalId(null);
    if (!localId) return;
    setSavingCloudLocalId(localId);
    try {
      await saveProjectToCloud(localId);
      announce('Saved to cloud');
    } catch (err) {
      setCloudError(friendlyErrorMessage(err, 'Failed to save to cloud.'));
    } finally {
      setSavingCloudLocalId(null);
    }
  }, [saveToCloudLocalId, saveProjectToCloud, announce]);

  const handleRemoveFromCloud = useCallback((localId: string) => {
    const project = projects.find(p => p.localId === localId);
    if (project?.isCloudSaved && project.cloudId) {
      setDeleteCloudConfirm({
        localId,
        cloudId: project.cloudId,
        name: projectDisplayName(project.name),
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
      setCloudError(friendlyErrorMessage(err, 'Failed to delete from cloud.'));
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
      triggerFileDownload(blob, 'register-viewer-recovery-key.json');
      announce('Recovery key downloaded');
    } catch {
      announce('Failed to download recovery key', { politeness: 'assertive' });
    }
  }, [announce]);

  const handleSettings = useCallback((localId: string) => {
    setSettingsLocalId(localId);
  }, []);

  const settingsInitialData = useMemo((): ProjectSettingsData => {
    if (!settingsLocalId) return { metadata: {}, addressUnitBits: 8 };
    const project = loadProject(settingsLocalId);
    if (!project) return { metadata: {}, addressUnitBits: 8 };
    return {
      metadata: project.state.project ?? {},
      addressUnitBits: project.state.addressUnitBits ?? 8,
    };
  }, [settingsLocalId]);

  const handleSettingsSave = useCallback((data: ProjectSettingsData) => {
    if (!settingsLocalId) return;
    const project = loadProject(settingsLocalId);
    if (!project) return;

    const sanitized = sanitizeProjectMetadata(data.metadata);
    // Title from settings overrides the manifest name; if cleared, keep existing name
    saveProject({
      ...project,
      name: sanitized?.title ?? project.name,
      state: {
        ...project.state,
        project: sanitized,
        addressUnitBits: data.addressUnitBits,
      },
    });

    // If editing the active project, also update AppState
    if (settingsLocalId === activeLocalId) {
      dispatch({ type: 'SET_PROJECT_METADATA', project: sanitized });
      dispatch({ type: 'SET_ADDRESS_UNIT_BITS', addressUnitBits: data.addressUnitBits });
    }

    refreshProjectList();
    announce('Project settings saved');
    setSettingsLocalId(null);
  }, [settingsLocalId, activeLocalId, dispatch, refreshProjectList, announce]);

  const dismissSettings = useCallback(() => setSettingsLocalId(null), []);
  const dismissShare = useCallback(() => setShareLocalId(null), []);

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

    // Settings
    handleSettings,
    settingsLocalId,
    settingsInitialData,
    handleSettingsSave,
    dismissSettings,

    // Share
    shareLocalId,
    dismissShare,

    // Cloud confirmation state + actions
    handleConfirmSaveToCloud,
    handleConfirmCloudDelete,
    isSaveToCloudOpen: saveToCloudLocalId !== null,
    isDeleteCloudConfirmOpen: deleteCloudConfirm !== null,
    cloudError,
    savingCloudLocalId,
    staleCloudIds,
    dismissCloudError,
    dismissSaveToCloud,
    dismissDeleteCloudConfirm,
  } as const;
}
