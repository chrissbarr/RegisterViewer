import { useState, useEffect, useCallback } from 'react';
import { Dialog } from './dialog';
import { CopyButton } from './copy-button';
import { loadLocalProjects, type LocalProjectRecord } from '../../utils/cloud-projects';
import { useCloudActions } from '../../context/cloud-context';

interface SavedProjectsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SavedProjectsDialog({ open, onClose }: SavedProjectsDialogProps) {
  const { deleteCloudById } = useCloudActions();
  const [projects, setProjects] = useState<LocalProjectRecord[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProjects(loadLocalProjects());
      setConfirmDeleteId(null);
      setError(null);
    }
  }, [open]);

  const handleDelete = useCallback(async (project: LocalProjectRecord) => {
    if (confirmDeleteId !== project.id) {
      setConfirmDeleteId(project.id);
      return;
    }

    setDeletingId(project.id);
    setError(null);

    try {
      await deleteCloudById(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      setConfirmDeleteId(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete project.';
      setError(message);
    } finally {
      setDeletingId(null);
    }
  }, [confirmDeleteId, deleteCloudById]);

  const handleOpen = useCallback((project: LocalProjectRecord) => {
    const url = `${window.location.href.split('#')[0]}#/p/${project.id}`;
    window.location.href = url;
    window.location.reload();
  }, []);

  const handleDownloadRecoveryKey = useCallback(() => {
    // Find the owner token from the first project (they should all use the same token)
    const token = projects[0]?.ownerToken;
    if (!token) return;

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
  }, [projects]);

  function formatDate(dateString: string): string {
    try {
      return new Date(dateString).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateString;
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title="My saved projects">
      <div className="space-y-3">
        {projects.length === 0 ? (
          <p className="text-sm text-gray-500 dark:text-gray-400 py-4 text-center">
            No saved projects yet.
          </p>
        ) : (
          <ul className="space-y-2">
            {projects.map((project) => {
              const shareUrl = project.shareUrl || `${window.location.href.split('#')[0]}#/p/${project.id}`;
              const isConfirming = confirmDeleteId === project.id;
              const isDeleting = deletingId === project.id;

              return (
                <li
                  key={project.id}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border
                    border-gray-200 dark:border-gray-700
                    bg-gray-50 dark:bg-gray-900"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                      {project.name || 'Untitled'}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Saved {formatDate(project.savedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <CopyButton value={shareUrl} label="Copy project URL" />
                    <button
                      onClick={() => handleOpen(project)}
                      title="Open project"
                      aria-label="Open project"
                      className="p-1 rounded text-gray-400 dark:text-gray-500
                        hover:text-blue-600 dark:hover:text-blue-400
                        hover:bg-gray-100 dark:hover:bg-gray-700
                        transition-colors"
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                        <path d="M3.5 1.75v11.5c0 .09.048.17.126.217a.25.25 0 0 0 .25-.004l5.49-3.12a.75.75 0 0 1 .739 0l5.49 3.12a.25.25 0 0 0 .374-.217V1.75a.25.25 0 0 0-.25-.25h-12a.25.25 0 0 0-.25.25ZM1.005 1.75C1.005.784 1.784.005 2.75.005h10.5c.966 0 1.745.779 1.745 1.745v11.876a1.748 1.748 0 0 1-2.626 1.514L8 12.626l-4.37 2.514A1.748 1.748 0 0 1 1.005 13.626Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(project)}
                      disabled={isDeleting}
                      title={isConfirming ? 'Click again to confirm delete' : 'Delete project'}
                      aria-label={isConfirming ? 'Confirm delete' : 'Delete project'}
                      className={`p-1 rounded transition-colors
                        ${isConfirming
                          ? 'text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/50'
                          : 'text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                        }
                        disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                        <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.15l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
                      </svg>
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {error && (
          <p className="text-xs text-red-500 dark:text-red-400">{error}</p>
        )}

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
  );
}
