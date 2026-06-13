import { useState, useMemo, useCallback } from 'react';
import { AnimatePresence } from 'motion/react';
import { Plus, Save, TriangleAlert } from 'lucide-react';
import { Dialog } from '../common/dialog';
import { ProjectSettingsDialog } from '../common/project-settings-dialog';
import { ShareDialog } from '../common/share-dialog';
import { ProjectListItem } from './project-list-item';
import { useProjectStorage } from '../../context/project-storage-context';
import { useAuth } from '../../context/auth-context';
import { useMyProjectsActions } from '../../hooks/use-my-projects-actions';
import { isCloudEnabled } from '../../utils/api-client';
import { getStorageUsage, hasLocalData } from '../../utils/project-storage';
import { Toast } from '../common/toast';
import { projectDisplayName } from '../../utils/project-helpers';

const FILTER_THRESHOLD = 8;
const STORAGE_WARNING_PERCENT = 80;

interface MyProjectsDialogProps {
  open: boolean;
  onClose: () => void;
  /** Optional guarded switch callback. When provided, handleOpen uses this instead of the default switchProject. */
  onSwitchProject?: (localId: string) => boolean | void;
  /** Guarded new-project callback. Creates an unsaved project, showing the unsaved prompt if needed. */
  onNewProject?: () => void;
  /** Callback to save the current unsaved project. Only provided when current project is unsaved. */
  onSaveProject?: () => void;
}

export function MyProjectsDialog({ open, onClose, onSwitchProject, onNewProject, onSaveProject }: MyProjectsDialogProps) {
  const { activeLocalId, projects } = useProjectStorage();
  const auth = useAuth();

  const [filter, setFilter] = useState('');
  const resetFilter = useCallback(() => setFilter(''), []);
  const actions = useMyProjectsActions(open, onClose, resetFilter, onSwitchProject);

  // Compute storage percent when dialog is open (derived, no state needed)
  const storagePercent = useMemo(
    () => (open ? getStorageUsage().percent : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `getStorageUsage` is a stable import; `projects` triggers recalc after delete
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
      projectDisplayName(p.name).toLowerCase().includes(query),
    );
  }, [sortedProjects, effectiveFilter]);

  // Detect cloud-only projects whose data has been evicted from localStorage
  const placeholderIds = useMemo(() => {
    const ids = new Set<string>();
    for (const p of projects) {
      if (p.storage === 'cloud' && !hasLocalData(p.localId)) {
        ids.add(p.localId);
      }
    }
    return ids;
  }, [projects]);

  const isSignedIn = !!auth.user;
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
          <div className="flex items-center gap-2">
            {onSaveProject && (
              <button
                onClick={() => { onSaveProject(); onClose(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                  text-gray-700 dark:text-gray-200
                  bg-gray-100 dark:bg-gray-700
                  hover:bg-gray-200 dark:hover:bg-gray-600
                  transition-colors"
              >
                <Save size={14} aria-hidden="true" />
                Save Project
              </button>
            )}
            <button
              onClick={onNewProject ?? actions.handleNewProject}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                bg-blue-600 text-white hover:bg-blue-500
                transition-colors"
            >
              <Plus size={14} aria-hidden="true" />
              New Project
            </button>
          </div>
        </div>

        {/* Storage warning */}
        {storagePercent >= STORAGE_WARNING_PERCENT && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-md text-xs font-medium
            bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400
            border border-amber-200 dark:border-amber-800"
          >
            <TriangleAlert size={14} aria-hidden="true" />
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
                  onClick={onNewProject ?? actions.handleNewProject}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
                    bg-blue-600 text-white hover:bg-blue-500
                    transition-colors"
                >
                  <Plus size={14} />
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
            {filteredProjects.map((project) => {
              const isPlaceholder = placeholderIds.has(project.localId);
              return (
                <ProjectListItem
                  key={project.localId}
                  project={project}
                  isActive={project.localId === activeLocalId}
                  isStub={isPlaceholder}
                  onOpen={actions.handleOpen}
                  onSettings={isPlaceholder ? undefined : actions.handleSettings}
                  onShare={isSignedIn ? actions.handleShare : undefined}
                  onDelete={actions.handleDelete}
                  onRename={actions.handleRename}
                  onChangeVisibility={isSignedIn && project.storage === 'cloud' ? actions.handleChangeVisibility : undefined}
                  onSaveToCloud={isSignedIn && project.storage !== 'cloud' ? actions.handleSaveToCloud : undefined}
                  onRemoveFromCloud={isSignedIn && project.storage === 'cloud' ? actions.handleRemoveFromCloud : undefined}
                  isDownloading={project.localId === actions.downloadingLocalId}
                />
              );
            })}
          </ul>
        )}

        {/* Footer: Sign-in prompt or signed-in status */}
        {projects.length > 0 && isCloudEnabled() && (
          <div className="pt-2 border-t border-gray-200 dark:border-gray-700">
            {auth.user ? (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Signed in as <span className="font-medium text-gray-700 dark:text-gray-300">{auth.user.email}</span>
              </p>
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Sign in with your email to access projects from any device.
                Use <span className="font-medium">Sign in</span> from the menu.
              </p>
            )}
          </div>
        )}
      </div>
    </Dialog>

    <ProjectSettingsDialog
      open={actions.settingsLocalId !== null}
      onClose={actions.dismissSettings}
      initialData={actions.settingsInitialData}
      onSave={actions.handleSettingsSave}
    />

    <ShareDialog
      open={actions.shareLocalId !== null}
      projectLocalId={actions.shareLocalId}
      onClose={actions.dismissShare}
    />

    <AnimatePresence>
      {actions.cloudError && (
        <Toast
          message={actions.cloudError}
          variant="error"
          duration={5000}
          onDismiss={actions.dismissCloudError}
        />
      )}
    </AnimatePresence>
    </>
  );
}
