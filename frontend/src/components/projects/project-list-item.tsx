import { useState } from 'react';
import { FolderOpen, Settings, Link, Trash2, CloudUpload, CloudOff } from 'lucide-react';
import type { ProjectListEntry, Visibility } from '../../types/project';
import { formatRelativeTime } from '../../utils/format';
import { projectDisplayName } from '../../utils/project-helpers';
import { InlineRename } from './inline-rename';
import { VisibilityBadge } from './visibility-badge';
import { DeleteConfirmation } from './delete-confirmation';

interface ProjectListItemProps {
  project: ProjectListEntry;
  isActive: boolean;
  isStub?: boolean;
  onOpen: (localId: string) => void;
  onShare?: (localId: string) => void;
  onDelete: (localId: string) => void;
  onRename: (localId: string, name: string) => void;
  onChangeVisibility?: (localId: string, v: Visibility) => void;
  onSettings?: (localId: string) => void;
  onSaveToCloud?: (localId: string) => void;
  onRemoveFromCloud?: (localId: string) => void;
  isDownloading?: boolean;
}

export function ProjectListItem({
  project,
  isActive,
  isStub,
  onOpen,
  onShare,
  onDelete,
  onRename,
  onChangeVisibility,
  onSettings,
  onSaveToCloud,
  onRemoveFromCloud,
  isDownloading,
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
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors
        ${isActive
          ? 'border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900'
        }
        ${isStub ? 'opacity-60' : ''}`}
    >
      {/* Left: info */}
      <div className="flex items-center gap-2 flex-1 min-w-0">
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
            {onChangeVisibility && (
              <VisibilityBadge
                visibility={project.visibility}
                onChangeVisibility={(v) => onChangeVisibility(project.localId, v)}
                projectName={displayName}
              />
            )}
          </div>
        </div>
      </div>

      {/* Right: Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {confirmingDelete ? (
          <DeleteConfirmation
            projectName={displayName}
            onConfirm={handleDelete}
            onCancel={handleCancelDelete}
          />
        ) : (
          <>
            {!isActive && (
              <button
                onClick={() => onOpen(project.localId)}
                disabled={isDownloading}
                title={`Open project ${displayName}`}
                aria-label={`Open project ${displayName}`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-blue-600 dark:hover:text-blue-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  disabled:opacity-50 disabled:cursor-not-allowed
                  transition-colors"
              >
                <FolderOpen size={16} className={isDownloading ? 'animate-pulse' : undefined} aria-hidden="true" />
              </button>
            )}
            {onSettings && (
              <button
                onClick={() => onSettings(project.localId)}
                title={`Project settings for ${displayName}`}
                aria-label={`Project settings for ${displayName}`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-blue-600 dark:hover:text-blue-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors"
              >
                <Settings size={16} aria-hidden="true" />
              </button>
            )}
            {onShare && (
              <button
                onClick={() => onShare(project.localId)}
                title={`Share project ${displayName}`}
                aria-label={`Share project ${displayName}`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-blue-600 dark:hover:text-blue-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors"
              >
                <Link size={16} aria-hidden="true" />
              </button>
            )}
            {onSaveToCloud && (
              <button
                onClick={() => onSaveToCloud(project.localId)}
                title={`Save to cloud`}
                aria-label={`Save project ${displayName} to cloud`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-blue-600 dark:hover:text-blue-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors"
              >
                <CloudUpload size={16} aria-hidden="true" />
              </button>
            )}
            {onRemoveFromCloud && (
              <button
                onClick={() => onRemoveFromCloud(project.localId)}
                title={`Remove from cloud`}
                aria-label={`Remove project ${displayName} from cloud`}
                className="p-1 rounded text-gray-400 dark:text-gray-500
                  hover:text-blue-600 dark:hover:text-blue-400
                  hover:bg-gray-100 dark:hover:bg-gray-700
                  transition-colors"
              >
                <CloudOff size={16} aria-hidden="true" />
              </button>
            )}
            <button
              onClick={() => setConfirmingDelete(true)}
              title={`Delete project ${displayName}`}
              aria-label={`Delete project ${displayName}`}
              className="p-1 rounded text-gray-400 dark:text-gray-500
                hover:text-red-600 dark:hover:text-red-400
                hover:bg-gray-100 dark:hover:bg-gray-700
                transition-colors"
            >
              <Trash2 size={16} aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}
