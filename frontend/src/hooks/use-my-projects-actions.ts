import { useState, useCallback, useEffect, useMemo } from 'react';
import { useProjectStorage, useProjectStorageActions } from '../context/project-storage-context';
import { useAppDispatch } from '../context/app-context';
import { useCloudSyncActions } from '../context/cloud-sync-context';
import { useAuthActions } from '../context/auth-context';
import { useAnnounce } from '../components/common/announcer';
import { isCloudEnabled } from '../utils/api-client';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { loadProject, saveProject, hasLocalData } from '../utils/project-storage';
import { isOwnedCloudEntry } from '../utils/project-identity';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { sanitizeProjectMetadata, serializeImportResult } from '../utils/storage';
import type { ProjectSettingsData } from '../components/common/project-settings-dialog';
import type { Visibility } from '../types/project';
import { projectDisplayName } from '../utils/project-helpers';

export function useMyProjectsActions(
  open: boolean,
  onClose: () => void,
  onBeforeNewProject?: () => void,
  onSwitchProject?: (localId: string) => boolean | void,
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
    if (!localId) {
      setCloudError('Failed to create project. Local storage may be full.');
      return;
    }
    switchProject(localId);
    announce('New project created');
    onBeforeNewProject?.();
    onClose();
  }, [createNewProject, switchProject, announce, onBeforeNewProject, onClose]);

  const handleOpen = useCallback(async (localId: string) => {
    const project = projects.find(p => p.localId === localId);
    if (!project) return;

    // Cloud project with evicted/missing local data — fetch full data first
    if (project.cloudId && !hasLocalData(localId)) {
      setDownloadingLocalId(localId);
      try {
        // JWT is optional — unauthenticated users can open shared projects
        const jwt = getJwt();
        const result = await fetchAndParseCloudProject(project.cloudId, jwt ?? undefined);
        const saveResult = saveProject({
          localId,
          cloudId: project.cloudId,
          name: project.name,
          visibility: project.visibility,
          createdAt: project.createdAt,
          localSavedAt: new Date().toISOString(),
          cloudSavedAt: result.updatedAt,
          storage: project.storage,
          serverVersion: result.version,
          hasUnsyncedChanges: false,
          state: serializeImportResult(result),
        }, { protectedLocalIds: [activeLocalId] });
        if (!saveResult.ok) {
          throw new Error(`Failed to persist downloaded project: ${saveResult.status}`);
        }
        refreshProjectList();
      } catch (err) {
        setDownloadingLocalId(null);
        setCloudError(friendlyErrorMessage(err, 'Failed to download project from cloud.'));
        return;
      }
      setDownloadingLocalId(null);
    }

    // Use guarded switch if provided (handles unsaved project prompt)
    if (onSwitchProject) {
      const switched = onSwitchProject(localId);
      if (switched === false) return;
    } else {
      if (!switchProject(localId)) return;
      onClose();
    }
    announce('Project opened');
  }, [projects, switchProject, announce, onClose, getJwt, setCloudError, onSwitchProject, refreshProjectList, activeLocalId]);

  const handleDelete = useCallback(async (localId: string) => {
    const project = projects.find(p => p.localId === localId);
    // Delete from cloud first if cloud-backed
    if (project && isOwnedCloudEntry(project)) {
      try {
        await deleteProjectFromCloud(localId);
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
    const metadata = { ...(project.state.project ?? {}) };
    // Fall back to manifest name if title is empty (handles legacy data)
    if (!metadata.title && project.name) {
      metadata.title = project.name;
    }
    return {
      metadata,
      addressUnitBits: project.state.addressUnitBits ?? 8,
    };
  }, [settingsLocalId]);

  const handleSettingsSave = useCallback((data: ProjectSettingsData) => {
    if (!settingsLocalId) return;
    const project = loadProject(settingsLocalId);
    if (!project) return;

    const sanitized = sanitizeProjectMetadata(data.metadata);
    // Title from settings overrides the manifest name; if cleared, keep existing name
    const saveResult = saveProject({
      ...project,
      name: sanitized?.title ?? project.name,
      hasUnsyncedChanges: project.storage === 'cloud' ? true : project.hasUnsyncedChanges,
      state: {
        ...project.state,
        project: sanitized,
        addressUnitBits: data.addressUnitBits,
      },
    }, { protectedLocalIds: [activeLocalId] });
    if (!saveResult.ok) {
      setCloudError('Failed to save project settings. Local storage may be full.');
      return;
    }

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
    if (!project || !isOwnedCloudEntry(project)) return;
    try {
      await deleteProjectFromCloud(localId);
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
