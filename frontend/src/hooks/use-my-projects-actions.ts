import { useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStorage, useProjectStorageActions } from '../context/project-storage-context';
import { useAppDispatch } from '../context/app-context';
import { useCloudSyncActions } from '../context/cloud-sync-context';
import { useAuthActions } from '../context/auth-context';
import { useAnnounce } from '../components/common/announcer';
import { isCloudEnabled } from '../utils/api-client';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { loadProject, saveProject, hasLocalData } from '../utils/project-storage';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { sanitizeProjectMetadata } from '../utils/storage';
import type { ProjectSettingsData } from '../components/common/project-settings-dialog';
import type { Visibility } from '../types/project';
import { projectDisplayName } from '../utils/project-helpers';

export function useMyProjectsActions(
  open: boolean,
  onClose: () => void,
  onBeforeNewProject?: () => void,
) {
  const { activeLocalId, projects } = useProjectStorage();
  const { createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList } = useProjectStorageActions();
  const { setProjectVisibility, syncCloudProjects, deleteProjectFromCloud, saveProjectToCloud } = useCloudSyncActions();
  const { getJwt } = useAuthActions();
  const announce = useAnnounce();

  const dispatch = useAppDispatch();

  const [downloadingLocalId, setDownloadingLocalId] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [settingsLocalId, setSettingsLocalId] = useState<string | null>(null);
  const [shareLocalId, setShareLocalId] = useState<string | null>(null);

  // Refresh project list and sync with cloud when dialog opens
  useEffect(() => {
    if (!open) return;
    refreshProjectList();
    if (isCloudEnabled()) {
      syncCloudProjects().then((result) => {
        if (result.placeholdersCreated > 0) refreshProjectList();
      }).catch((err) => {
        setCloudError(friendlyErrorMessage(err, 'Failed to sync cloud projects.'));
      });
    }
    return () => {
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

  const handleOpen = useCallback(async (localId: string) => {
    const project = projects.find(p => p.localId === localId);

    // Cloud project with evicted/missing local data — fetch full data first
    if (project?.cloudId && !hasLocalData(localId)) {
      setDownloadingLocalId(localId);
      try {
        const jwt = getJwt();
        const result = await fetchAndParseCloudProject(project.cloudId, jwt ?? undefined);
        const serializedValues: Record<string, string> = {};
        for (const [id, value] of Object.entries(result.values)) {
          serializedValues[id] = '0x' + value.toString(16);
        }
        saveProject({
          localId,
          cloudId: project.cloudId,
          name: project.name,
          visibility: project.visibility,
          createdAt: project.createdAt,
          localSavedAt: new Date().toISOString(),
          cloudSavedAt: project.cloudSavedAt,
          storage: project.storage,
          state: {
            registers: result.registers,
            activeRegisterId: result.registers[0]?.id ?? null,
            registerValues: serializedValues,
            project: result.project,
            addressUnitBits: result.addressUnitBits,
          },
        });
      } catch (err) {
        setDownloadingLocalId(null);
        setCloudError(friendlyErrorMessage(err, 'Failed to download project from cloud.'));
        return;
      }
      setDownloadingLocalId(null);
    }

    switchProject(localId);
    announce('Project opened');
    onClose();
  }, [projects, switchProject, announce, onClose, getJwt, setCloudError]);

  const handleDelete = useCallback(async (localId: string) => {
    const project = projects.find(p => p.localId === localId);
    // Delete from cloud first if cloud-backed
    if (project?.cloudId) {
      try {
        await deleteProjectFromCloud(project.cloudId);
      } catch {
        // Best-effort — delete locally regardless
      }
    }
    deleteLocalProject(localId);
    announce(`Project "${projectDisplayName(project?.name)}" deleted`);
  }, [deleteLocalProject, deleteProjectFromCloud, announce, projects]);

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

  const handleSaveToCloud = useCallback(async (localId: string) => {
    const jwt = getJwt();
    if (!jwt) return;
    try {
      await saveProjectToCloud(localId);
      refreshProjectList();
      announce('Project saved to cloud');
    } catch (err) {
      setCloudError(friendlyErrorMessage(err, 'Failed to save project to cloud.'));
    }
  }, [getJwt, saveProjectToCloud, refreshProjectList, announce]);

  const handleRemoveFromCloud = useCallback(async (localId: string) => {
    const project = projects.find(p => p.localId === localId);
    if (!project?.cloudId) return;
    try {
      await deleteProjectFromCloud(project.cloudId);
      refreshProjectList();
      announce('Project removed from cloud');
    } catch (err) {
      setCloudError(friendlyErrorMessage(err, 'Failed to remove project from cloud.'));
    }
  }, [projects, deleteProjectFromCloud, refreshProjectList, announce]);

  const dismissCloudError = useCallback(() => setCloudError(null), []);

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

    // Settings
    handleSettings,
    settingsLocalId,
    settingsInitialData,
    handleSettingsSave,
    dismissSettings,

    // Share
    shareLocalId,
    dismissShare,

    // Cloud state
    cloudError,
    downloadingLocalId,
    dismissCloudError,
  } as const;
}
