import { useState } from 'react';
import type { ProjectListEntry, Visibility } from '../../types/project';
import { CloudStatusIndicator } from './cloud-status-indicator';
import { InlineRename } from './inline-rename';
import { VisibilityBadge } from './visibility-badge';
import { DeleteConfirmation } from './delete-confirmation';

interface ProjectListItemProps {
  project: ProjectListEntry;
  isActive: boolean;
  onOpen: (localId: string) => void;
  onShare: (localId: string) => void;
  onDelete: (localId: string) => void;
  onRename: (localId: string, name: string) => void;
  onChangeVisibility?: (localId: string, v: Visibility) => void;
}

/** Format an ISO date string as a relative timestamp */
function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = Date.now();
    const diffMs = now - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHr = Math.floor(diffMin / 60);
    const diffDays = Math.floor(diffHr / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}),
    });
  } catch {
    return dateString;
  }
}

export function ProjectListItem({
  project,
  isActive,
  onOpen,
  onShare,
  onDelete,
  onRename,
  onChangeVisibility,
}: ProjectListItemProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const handleDelete = () => {
    onDelete(project.localId);
    setConfirmingDelete(false);
  };

  const handleCancelDelete = () => {
    setConfirmingDelete(false);
  };

  return (
    <li
      aria-current={isActive ? 'true' : undefined}
      className={`flex items-start gap-3 px-3 py-2.5 rounded-lg border transition-colors
        ${isActive
          ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'
        }`}
    >
      {/* Left: cloud status + info */}
      <div className="flex items-start gap-2 flex-1 min-w-0 pt-0.5">
        <CloudStatusIndicator isCloudSaved={project.isCloudSaved} />
        <div className="flex-1 min-w-0">
          {/* Line 1: Name + Active badge */}
          <div className="flex items-center gap-2">
            <InlineRename
              name={project.name || 'Untitled Project'}
              onRename={(newName) => onRename(project.localId, newName)}
              projectName={project.name || 'Untitled Project'}
            />
            {isActive && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium
                bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400 shrink-0">
                Active
              </span>
            )}
          </div>
          {/* Line 2: Timestamp + Visibility */}
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-gray-500 dark:text-gray-400">
              Modified {formatRelativeTime(project.localSavedAt)}
            </span>
            {project.isCloudSaved && (
              <VisibilityBadge
                visibility={project.visibility}
                isCloudSaved={project.isCloudSaved}
                onChangeVisibility={onChangeVisibility
                  ? (v) => onChangeVisibility(project.localId, v)
                  : undefined}
                projectName={project.name || 'Untitled Project'}
              />
            )}
          </div>
        </div>
      </div>

      {/* Right: Action buttons */}
      <div className="flex items-center gap-1 shrink-0 pt-0.5">
        {confirmingDelete ? (
          <DeleteConfirmation
            projectName={project.name || 'Untitled Project'}
            isCloudSaved={project.isCloudSaved}
            onConfirm={handleDelete}
            onCancel={handleCancelDelete}
          />
        ) : (
          <>
            {!isActive && (
              <button
                onClick={() => onOpen(project.localId)}
                title={`Open project ${project.name || 'Untitled Project'}`}
                aria-label={`Open project ${project.name || 'Untitled Project'}`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-blue-600 dark:hover:text-blue-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M1.97 2.97a.75.75 0 0 1 1.06 0L8 7.94l4.97-4.97a.75.75 0 1 1 1.06 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-5.5-5.5a.75.75 0 0 1 0-1.06Z" />
                  <path d="M1.97 7.97a.75.75 0 0 1 1.06 0L8 12.94l4.97-4.97a.75.75 0 1 1 1.06 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-5.5-5.5a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => onShare(project.localId)}
              title={`Share project ${project.name || 'Untitled Project'}`}
              aria-label={`Share project ${project.name || 'Untitled Project'}`}
              className="p-1 rounded text-gray-400 dark:text-gray-500
                hover:text-blue-600 dark:hover:text-blue-400
                hover:bg-gray-100 dark:hover:bg-gray-700
                transition-colors"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-.8 9.45a.75.75 0 0 0 1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 0 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25Z" />
              </svg>
            </button>
            <button
              onClick={() => setConfirmingDelete(true)}
              title={`Delete project ${project.name || 'Untitled Project'}`}
              aria-label={`Delete project ${project.name || 'Untitled Project'}`}
              className="p-1 rounded text-gray-400 dark:text-gray-500
                hover:text-red-600 dark:hover:text-red-400
                hover:bg-gray-100 dark:hover:bg-gray-700
                transition-colors"
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                <path d="M11 1.75V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675l.66 6.6a.25.25 0 0 0 .249.225h5.19a.25.25 0 0 0 .249-.225l.66-6.6a.75.75 0 0 1 1.492.15l-.66 6.6A1.748 1.748 0 0 1 10.595 15h-5.19a1.75 1.75 0 0 1-1.741-1.575l-.66-6.6a.75.75 0 1 1 1.492-.15ZM6.5 1.75V3h3V1.75a.25.25 0 0 0-.25-.25h-2.5a.25.25 0 0 0-.25.25Z" />
              </svg>
            </button>
          </>
        )}
      </div>
    </li>
  );
}
