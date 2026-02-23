import { useState, useMemo, useCallback, useEffect } from 'react';
import { Dialog } from '../common/dialog';
import { ConfirmationDialog } from '../common/confirmation-dialog';
import { ProjectListItem } from './project-list-item';
import { useProjectStorage, useProjectStorageActions } from '../../context/project-storage-context';
import { useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';
import { useAnnounce } from '../common/announcer';
import { isCloudEnabled } from '../../utils/api-client';
import { getStorageUsage } from '../../utils/project-storage';
import type { Visibility } from '../../types/project';

const FILTER_THRESHOLD = 8;
const STORAGE_WARNING_PERCENT = 80;

interface MyProjectsDialogProps {
  open: boolean;
  onClose: () => void;
  onShareProject?: (localId: string) => void;
}

export function MyProjectsDialog({ open, onClose, onShareProject }: MyProjectsDialogProps) {
  const { activeLocalId, projects } = useProjectStorage();
  const { createNewProject, switchProject, deleteLocalProject, renameProject, refreshProjectList } = useProjectStorageActions();
  const { setVisibility, syncCloudProjects, deleteProjectFromCloud, unlinkCloudProject, saveToCloud } = useCloudSyncActions();
  const cloudState = useCloudSync();
  const announce = useAnnounce();

  const [filter, setFilter] = useState('');
  const [staleCloudIds, setStaleCloudIds] = useState<string[]>([]);
  const [deleteCloudConfirm, setDeleteCloudConfirm] = useState<{ localId: string; cloudId: string; name: string } | null>(null);
  const [cloudDeleteError, setCloudDeleteError] = useState<string | null>(null);
  const [showFirstTimeCloudPrompt, setShowFirstTimeCloudPrompt] = useState<string | null>(null); // localId of project to save

  // Refresh project list and sync with cloud when dialog opens
  useEffect(() => {
    if (open) {
      refreshProjectList();
      // Sync cloud projects in the background
      if (isCloudEnabled()) {
        syncCloudProjects().then((result) => {
          setStaleCloudIds(result.staleCloudIds);
          if (result.updatedCount > 0 || result.staleCloudIds.length > 0) {
            refreshProjectList();
          }
        });
      }
    } else {
      // Reset stale cloud IDs when dialog closes
      setStaleCloudIds([]);
    }
  }, [open, refreshProjectList, syncCloudProjects]);

  // Compute storage percent when dialog is open (derived, no state needed)
  const storagePercent = useMemo(
    () => (open ? getStorageUsage().percent : 0),
    // Recalculate when open changes or projects change (after delete)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [open, projects],
  );

  // Reset filter when dialog closes, so it's clean on next open
  const effectiveFilter = open ? filter : '';

  // Sort most-recent first
  const sortedProjects = useMemo(() => {
    return [...projects].sort(
      (a, b) => new Date(b.localSavedAt).getTime() - new Date(a.localSavedAt).getTime(),
    );
  }, [projects]);

  // Apply filter
  const filteredProjects = useMemo(() => {
    if (!effectiveFilter.trim()) return sortedProjects;
    const query = effectiveFilter.toLowerCase().trim();
    return sortedProjects.filter((p) =>
      (p.name || 'Untitled Project').toLowerCase().includes(query),
    );
  }, [sortedProjects, effectiveFilter]);

  const showFilter = projects.length > FILTER_THRESHOLD;

  const handleNewProject = useCallback(() => {
    const localId = createNewProject();
    switchProject(localId);
    announce('New project created');
    setFilter('');
    onClose();
  }, [createNewProject, switchProject, announce, onClose]);

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

  const handleConfirmCloudDelete = useCallback(async () => {
    if (!deleteCloudConfirm) return;
    try {
      await deleteProjectFromCloud(deleteCloudConfirm.cloudId);
      refreshProjectList();
      announce('Removed from cloud');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete from cloud.';
      setCloudDeleteError(message);
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

  const handleRename = useCallback((localId: string, name: string) => {
    renameProject(localId, name);
    announce(`Project renamed to "${name}"`);
  }, [renameProject, announce]);

  const handleShare = useCallback((localId: string) => {
    // Switch to the project if it's not active, then open share dialog
    if (localId !== activeLocalId) {
      switchProject(localId);
    }
    // onShareProject closes My Projects and opens Share in the same render batch
    if (onShareProject) {
      onShareProject(localId);
    }
  }, [activeLocalId, switchProject, onShareProject]);

  const handleChangeVisibility = useCallback(async (_localId: string, v: Visibility) => {
    await setVisibility(v);
    refreshProjectList();
    announce(`Visibility changed to ${v}`);
  }, [setVisibility, refreshProjectList, announce]);

  const handleSaveToCloud = useCallback((localId: string) => {
    // Must switch to the project first so saveToCloud operates on it
    if (localId !== activeLocalId) {
      switchProject(localId);
    }
    setShowFirstTimeCloudPrompt(localId);
  }, [activeLocalId, switchProject]);

  const handleConfirmSaveToCloud = useCallback(async () => {
    setShowFirstTimeCloudPrompt(null);
    await saveToCloud();
    refreshProjectList();
    announce('Saved to cloud');
  }, [saveToCloud, refreshProjectList, announce]);

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

  const handleDownloadRecoveryKey = useCallback(() => {
    try {
      const token = localStorage.getItem('register-viewer-owner-token');
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

  return (
    <>
    <Dialog open={open} onClose={onClose} title="My Projects" maxWidth="max-w-2xl">
      <div className="flex flex-col gap-3">
        {/* Header actions row */}
        <div className="flex items-center justify-between">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {projects.length} {projects.length === 1 ? 'project' : 'projects'}
          </div>
          <button
            onClick={handleNewProject}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-500
              transition-colors"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
            </svg>
            New Project
          </button>
        </div>

        {/* Storage warning */}
        {storagePercent >= STORAGE_WARNING_PERCENT && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium
            bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400
            border border-amber-200 dark:border-amber-800"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
              <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
            </svg>
            Local storage is {storagePercent}% full. Delete old projects to free space.
          </div>
        )}

        {/* Filter input */}
        {showFilter && (
          <input
            type="text"
            value={effectiveFilter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter projects..."
            aria-label="Filter projects"
            className="w-full px-3 py-1.5 rounded-md text-sm
              bg-gray-100 dark:bg-gray-700
              text-gray-800 dark:text-gray-200
              placeholder-gray-400 dark:placeholder-gray-500
              border border-gray-200 dark:border-gray-600
              focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500
              focus:border-transparent"
          />
        )}

        {/* Project list */}
        {filteredProjects.length === 0 ? (
          <div className="py-8 text-center">
            {projects.length === 0 ? (
              <>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                  No projects yet.
                </p>
                <button
                  onClick={handleNewProject}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                    bg-blue-600 text-white hover:bg-blue-500
                    transition-colors"
                >
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" />
                  </svg>
                  Create your first project
                </button>
              </>
            ) : (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                No projects match &ldquo;{effectiveFilter}&rdquo;
              </p>
            )}
          </div>
        ) : (
          <ul className="space-y-2" role="list">
            {filteredProjects.map((project) => (
              <ProjectListItem
                key={project.localId}
                project={project}
                isActive={project.localId === activeLocalId}
                isStaleCloud={project.cloudId !== null && staleCloudIds.includes(project.cloudId)}
                onOpen={handleOpen}
                onShare={handleShare}
                onDelete={handleDelete}
                onRename={handleRename}
                onChangeVisibility={handleChangeVisibility}
                onUnlinkCloud={handleUnlinkCloud}
                onSaveToCloud={isCloudEnabled() ? handleSaveToCloud : undefined}
                onRemoveFromCloud={isCloudEnabled() ? handleRemoveFromCloud : undefined}
                isSavingToCloud={cloudState.status === 'saving'}
              />
            ))}
          </ul>
        )}

        {/* Footer: Recovery key download */}
        {projects.length > 0 && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={handleDownloadRecoveryKey}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200
                transition-colors underline"
            >
              Download recovery key
            </button>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              Keep this file safe. It allows recovering ownership of your projects if you clear browser data.
            </p>
          </div>
        )}
      </div>
    </Dialog>

    {/* First-time cloud save confirmation */}
    <ConfirmationDialog
      open={showFirstTimeCloudPrompt !== null}
      onClose={() => setShowFirstTimeCloudPrompt(null)}
      onConfirm={handleConfirmSaveToCloud}
      title="Save to Cloud"
      description="Your project will be uploaded to our servers and you'll get a shareable link."
      confirmLabel="Save to Cloud"
      cancelLabel="Cancel"
    >
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-4 py-3 mb-2">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          Your browser stores an ownership token. Download a recovery key from &ldquo;My Projects&rdquo; to protect against browser data loss.
        </p>
      </div>
    </ConfirmationDialog>

    {/* Cloud delete confirmation dialog */}
    <ConfirmationDialog
      open={deleteCloudConfirm !== null}
      onClose={() => setDeleteCloudConfirm(null)}
      onConfirm={handleConfirmCloudDelete}
      title="Remove from Cloud"
      description="This will delete the cloud copy. Shared links will stop working. Your local copy will remain."
      confirmLabel="Remove from Cloud"
      cancelLabel="Cancel"
      variant="destructive"
    />

    {/* Cloud delete error toast */}
    {cloudDeleteError && (
      <div
        role="alert"
        className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg
          bg-red-600 text-white text-sm font-medium
          animate-in fade-in slide-in-from-bottom-2"
      >
        {cloudDeleteError}
        <button
          onClick={() => setCloudDeleteError(null)}
          className="ml-3 text-white/80 hover:text-white"
          aria-label="Dismiss error"
        >
          &times;
        </button>
      </div>
    )}
    </>
  );
}
