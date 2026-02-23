import { useState } from 'react';
import type { ProjectListEntry, Visibility } from '../../types/project';
import { projectDisplayName } from '../../utils/project-helpers';
import { CloudStatusIndicator } from './cloud-status-indicator';
import { InlineRename } from './inline-rename';
import { VisibilityBadge } from './visibility-badge';
import { DeleteConfirmation } from './delete-confirmation';

interface ProjectListItemProps {
  project: ProjectListEntry;
  isActive: boolean;
  isStaleCloud?: boolean;
  onOpen: (localId: string) => void;
  onShare: (localId: string) => void;
  onDelete: (localId: string) => void;
  onRename: (localId: string, name: string) => void;
  onChangeVisibility?: (localId: string, v: Visibility) => void;
  onUnlinkCloud?: (localId: string) => void;
  onSaveToCloud?: (localId: string) => void;
  onRemoveFromCloud?: (localId: string) => void;
  isSavingToCloud?: boolean;
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
  isStaleCloud,
  onOpen,
  onShare,
  onDelete,
  onRename,
  onChangeVisibility,
  onUnlinkCloud,
  onSaveToCloud,
  onRemoveFromCloud,
  isSavingToCloud,
}: ProjectListItemProps) {
  const displayName = projectDisplayName(project.name);
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
              name={displayName}
              onRename={(newName) => onRename(project.localId, newName)}
              projectName={displayName}
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
            {project.isCloudSaved && !isStaleCloud && (
              <VisibilityBadge
                visibility={project.visibility}
                isCloudSaved={project.isCloudSaved}
                onChangeVisibility={onChangeVisibility
                  ? (v) => onChangeVisibility(project.localId, v)
                  : undefined}
                projectName={displayName}
              />
            )}
            {isStaleCloud && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true">
                  <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
                </svg>
                Cloud copy not found
                {onUnlinkCloud && (
                  <button
                    onClick={() => onUnlinkCloud(project.localId)}
                    className="underline hover:text-amber-700 dark:hover:text-amber-300"
                  >
                    Remove link
                  </button>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: Action buttons */}
      <div className="flex items-center gap-1 shrink-0 pt-0.5">
        {confirmingDelete ? (
          <DeleteConfirmation
            projectName={displayName}
            isCloudSaved={project.isCloudSaved}
            onConfirm={handleDelete}
            onCancel={handleCancelDelete}
          />
        ) : (
          <>
            {/* Save to cloud (local-only projects) */}
            {!project.isCloudSaved && onSaveToCloud && (
              <button
                onClick={() => onSaveToCloud(project.localId)}
                disabled={isSavingToCloud}
                title="Save to cloud"
                aria-label={`Save project ${displayName} to cloud`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-blue-600 dark:hover:text-blue-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors"
              >
                {isSavingToCloud ? (
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" className="animate-pulse" aria-hidden="true">
                    <path d="M8 2.002a4.998 4.998 0 0 0-4.868 3.862A3.5 3.5 0 0 0 3.5 12.5h9a3.5 3.5 0 0 0 .368-6.636A4.998 4.998 0 0 0 8 2.002ZM7.25 7.25v2.5a.75.75 0 0 0 1.5 0v-2.5l.97.97a.75.75 0 1 0 1.06-1.06l-2.25-2.25a.75.75 0 0 0-1.06 0L5.22 7.16a.75.75 0 1 0 1.06 1.06l.97-.97Z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M8 2.002a4.998 4.998 0 0 0-4.868 3.862A3.5 3.5 0 0 0 3.5 12.5h9a3.5 3.5 0 0 0 .368-6.636A4.998 4.998 0 0 0 8 2.002ZM7.25 7.25v2.5a.75.75 0 0 0 1.5 0v-2.5l.97.97a.75.75 0 1 0 1.06-1.06l-2.25-2.25a.75.75 0 0 0-1.06 0L5.22 7.16a.75.75 0 1 0 1.06 1.06l.97-.97Z" />
                  </svg>
                )}
              </button>
            )}
            {/* Remove from cloud (cloud projects) */}
            {project.isCloudSaved && onRemoveFromCloud && (
              <button
                onClick={() => onRemoveFromCloud(project.localId)}
                title="Remove from cloud"
                aria-label={`Remove project ${displayName} from cloud`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-amber-600 dark:hover:text-amber-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors"
              >
                <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
                  <path d="M8 2.002a4.998 4.998 0 0 0-4.868 3.862A3.5 3.5 0 0 0 3.5 12.5h9a3.5 3.5 0 0 0 .368-6.636A4.998 4.998 0 0 0 8 2.002ZM5.72 6.72a.75.75 0 0 1 1.06 0L8 7.94l1.22-1.22a.75.75 0 1 1 1.06 1.06L9.06 9l1.22 1.22a.75.75 0 1 1-1.06 1.06L8 10.06l-1.22 1.22a.75.75 0 0 1-1.06-1.06L6.94 9 5.72 7.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              </button>
            )}
            {!isActive && (
              <button
                onClick={() => onOpen(project.localId)}
                title={`Open project ${displayName}`}
                aria-label={`Open project ${displayName}`}
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
              title={`Share project ${displayName}`}
              aria-label={`Share project ${displayName}`}
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
              title={`Delete project ${displayName}`}
              aria-label={`Delete project ${displayName}`}
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
