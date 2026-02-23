import { useState, useMemo, useCallback } from 'react';
import { Dialog } from '../common/dialog';
import { ProjectListItem } from './project-list-item';
import { MyProjectsCloudDialogs } from './my-projects-cloud-dialogs';
import { useProjectStorage } from '../../context/project-storage-context';
import { useCloudSync } from '../../context/cloud-sync-context';
import { useMyProjectsActions } from '../../hooks/use-my-projects-actions';
import { isCloudEnabled } from '../../utils/api-client';
import { getStorageUsage } from '../../utils/project-storage';

const FILTER_THRESHOLD = 8;
const STORAGE_WARNING_PERCENT = 80;

interface MyProjectsDialogProps {
  open: boolean;
  onClose: () => void;
  onShareProject?: (localId: string) => void;
}

export function MyProjectsDialog({ open, onClose, onShareProject }: MyProjectsDialogProps) {
  const { activeLocalId, projects } = useProjectStorage();
  const cloudState = useCloudSync();

  const [filter, setFilter] = useState('');
  const resetFilter = useCallback(() => setFilter(''), []);
  const actions = useMyProjectsActions(open, onClose, onShareProject, resetFilter);

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
            onClick={actions.handleNewProject}
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
                  onClick={actions.handleNewProject}
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
                isStaleCloud={project.cloudId !== null && actions.staleCloudIds.includes(project.cloudId)}
                onOpen={actions.handleOpen}
                onShare={actions.handleShare}
                onDelete={actions.handleDelete}
                onRename={actions.handleRename}
                onChangeVisibility={actions.handleChangeVisibility}
                onUnlinkCloud={actions.handleUnlinkCloud}
                onSaveToCloud={isCloudEnabled() ? actions.handleSaveToCloud : undefined}
                onRemoveFromCloud={isCloudEnabled() ? actions.handleRemoveFromCloud : undefined}
                isSavingToCloud={cloudState.status === 'saving'}
              />
            ))}
          </ul>
        )}

        {/* Footer: Recovery key download */}
        {projects.length > 0 && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            <button
              onClick={actions.handleDownloadRecoveryKey}
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

    <MyProjectsCloudDialogs
      isSaveToCloudOpen={actions.isSaveToCloudOpen}
      onDismissSaveToCloud={actions.dismissSaveToCloud}
      onConfirmSaveToCloud={actions.handleConfirmSaveToCloud}
      isDeleteCloudConfirmOpen={actions.isDeleteCloudConfirmOpen}
      onDismissDeleteCloudConfirm={actions.dismissDeleteCloudConfirm}
      onConfirmCloudDelete={actions.handleConfirmCloudDelete}
      cloudError={actions.cloudError}
      onDismissCloudError={actions.dismissCloudError}
    />
    </>
  );
}
