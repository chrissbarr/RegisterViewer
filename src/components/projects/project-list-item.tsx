import { useState } from 'react';
import { TriangleAlert, CloudUpload, CloudOff, ChevronsDown, Link, Trash2 } from 'lucide-react';
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
                <TriangleAlert size={12} aria-hidden="true" />
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
                <CloudUpload size={14} className={isSavingToCloud ? 'animate-pulse' : undefined} aria-hidden="true" />
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
                <CloudOff size={14} aria-hidden="true" />
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
                <ChevronsDown size={14} aria-hidden="true" />
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
              <Link size={14} aria-hidden="true" />
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
              <Trash2 size={14} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
