import { useMemo, useState, useCallback, useDeferredValue, useEffect } from 'react';
import { Dialog } from './dialog';
import { CopyButton } from './copy-button';
import { useAppState } from '../../context/app-context';
import { buildSnapshotUrl } from '../../utils/snapshot-url';
import { isCloudEnabled } from '../../utils/api-client';
import { friendlyErrorMessage } from '../../utils/friendly-error';
import { useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';
import { useAuth } from '../../context/auth-context';
import { useProjectStorage } from '../../context/project-storage-context';
import { loadProject, buildProjectUrl } from '../../utils/project-storage';
import { deserializeState } from '../../utils/storage';
import type { AppState } from '../../types/register';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  /** When provided, shows share info for this project instead of the active project. */
  projectLocalId?: string | null;
}

export function ShareDialog({ open, onClose, projectLocalId }: ShareDialogProps) {
  const activeState = useAppState();
  const cloud = useCloudSync();
  const cloudActions = useCloudSyncActions();
  const { projects } = useProjectStorage();
  const { user } = useAuth();
  const [isSavingByLocalId, setIsSavingByLocalId] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Bumped after save/visibility mutations to force cloudInfo memo to re-read manifest
  const [refreshKey, setRefreshKey] = useState(0);

  // Reset transient state when dialog opens
  useEffect(() => {
    if (open) {
      setSaveError(null);
    }
  }, [open]);

  // When projectLocalId is provided, load that project's state from localStorage.
  // Otherwise fall back to the active project's state from context.
  const storedTargetState = useMemo((): AppState | null => {
    if (!open || !projectLocalId) return null;
    const stored = loadProject(projectLocalId);
    return stored ? deserializeState(stored.state) : null;
  }, [open, projectLocalId]);

  const targetState = projectLocalId ? storedTargetState : (open ? activeState : null);

  // Resolve cloud info: from manifest entry when projectLocalId is given, else from context.
  const cloudInfo = useMemo(() => {
    if (!projectLocalId) {
      return {
        cloudId: cloud.cloudId,
        shareUrl: cloud.shareUrl,
        visibility: cloud.visibility,
        isSaving: cloud.status === 'saving',
      };
    }
    const entry = projects.find(p => p.localId === projectLocalId);
    return {
      cloudId: entry?.cloudId ?? null,
      shareUrl: entry?.cloudId ? buildProjectUrl(entry.cloudId) : null,
      visibility: (entry?.visibility ?? 'private') as 'private' | 'unlisted',
      isSaving: isSavingByLocalId,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refreshKey is an invalidation trigger, not used in computation
  }, [projectLocalId, projects, cloud.cloudId, cloud.shareUrl, cloud.visibility, cloud.status, isSavingByLocalId, refreshKey]);

  // Defer targetState so snapshot computation doesn't block dialog open render
  const deferredTargetState = useDeferredValue(targetState);

  const [snapshotUrl, setSnapshotUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!open) {
      setSnapshotUrl(undefined);
      return;
    }
    if (!deferredTargetState) {
      setSnapshotUrl(null);
      return;
    }
    let cancelled = false;
    setSnapshotUrl(undefined);
    buildSnapshotUrl(deferredTargetState)
      .then((url) => { if (!cancelled) setSnapshotUrl(url); })
      .catch(() => { if (!cancelled) setSnapshotUrl(null); });
    return () => { cancelled = true; };
  }, [open, deferredTargetState]);

  const charCount = snapshotUrl?.length ?? 0;
  const isUrlLong = charCount > 2000;

  const hasCloudProject = cloudInfo.cloudId !== null;

  // Shared save logic for both first-time and update paths
  const doSave = useCallback(() => {
    setSaveError(null);
    if (projectLocalId) {
      setIsSavingByLocalId(true);
      cloudActions.saveProjectToCloud(projectLocalId)
        .then(() => setRefreshKey(k => k + 1))
        .catch((err: unknown) => {
          setSaveError(friendlyErrorMessage(err, 'Failed to save to cloud.'));
        })
        .finally(() => setIsSavingByLocalId(false));
    } else {
      cloudActions.saveToCloud();
    }
  }, [projectLocalId, cloudActions]);

  const handleSaveToCloud = useCallback(() => {
    doSave();
  }, [doSave]);

  const handleMakeUnlisted = useCallback(() => {
    if (projectLocalId) {
      cloudActions.setProjectVisibility(projectLocalId, 'unlisted')
        .then(() => setRefreshKey(k => k + 1))
        .catch((err: unknown) => {
          setSaveError(friendlyErrorMessage(err, 'Failed to change visibility.'));
        });
    } else {
      cloudActions.setVisibility('unlisted');
    }
  }, [projectLocalId, cloudActions]);

  return (
    <Dialog open={open} onClose={onClose} title="Share">
      <div className="space-y-5">
        {/* Snapshot URL section */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
            Snapshot URL
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
            Contains the full project data encoded in the URL. No server needed.
          </p>
          {snapshotUrl ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={snapshotUrl}
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-md border
                    border-gray-300 dark:border-gray-600
                    bg-gray-50 dark:bg-gray-900
                    text-gray-700 dark:text-gray-300
                    truncate"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <CopyButton value={snapshotUrl} label="Copy snapshot URL" />
              </div>
              <p className={`text-xs ${isUrlLong ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-gray-400'}`}>
                {charCount.toLocaleString()} characters
                {isUrlLong && ' — URL is long and may not work in all browsers or messaging apps.'}
              </p>
            </div>
          ) : snapshotUrl === null ? (
            <p className="text-xs text-red-500">Failed to generate snapshot URL.</p>
          ) : null}
        </div>

        {/* Cloud link section */}
        {isCloudEnabled() && (
          <CloudLinkSection
            hasCloudProject={hasCloudProject}
            isSignedIn={user !== null}
            cloudUrl={cloudInfo.shareUrl}
            visibility={cloudInfo.visibility}
            isSaving={cloudInfo.isSaving}
            error={saveError}
            onSaveToCloud={handleSaveToCloud}
            onMakeUnlisted={handleMakeUnlisted}
          />
        )}
      </div>
    </Dialog>
  );
}

interface CloudLinkSectionProps {
  hasCloudProject: boolean;
  isSignedIn: boolean;
  cloudUrl: string | null;
  visibility: 'private' | 'unlisted';
  isSaving: boolean;
  error: string | null;
  onSaveToCloud: () => void;
  onMakeUnlisted: () => void;
}

function CloudLinkSection({
  hasCloudProject,
  isSignedIn,
  cloudUrl,
  visibility,
  isSaving,
  error,
  onSaveToCloud,
  onMakeUnlisted,
}: CloudLinkSectionProps) {
  // State A: cloud + unlisted — show URL + copy + badge
  if (hasCloudProject && visibility === 'unlisted' && cloudUrl) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
            Cloud link
          </h3>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            Unlisted
          </span>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Short link. Anyone with this link can view.
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            readOnly
            value={cloudUrl}
            className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-md border
              border-gray-300 dark:border-gray-600
              bg-gray-50 dark:bg-gray-900
              text-gray-700 dark:text-gray-300
              truncate"
            onClick={(e) => (e.target as HTMLInputElement).select()}
          />
          <CopyButton value={cloudUrl} label="Copy cloud link" />
        </div>
      </div>
    );
  }

  // State B: cloud + private — info box with "Make Unlisted" button
  if (hasCloudProject && visibility === 'private') {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Cloud link
        </h3>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            This project is private. Make it unlisted to generate a shareable link.
          </p>
          <button
            onClick={onMakeUnlisted}
            className="px-3 py-1.5 rounded-md text-sm font-medium
              bg-blue-600 text-white hover:bg-blue-500
              transition-colors"
          >
            Make Unlisted
          </button>
        </div>
      </div>
    );
  }

  // State C: not cloud-saved, signed out — prompt to sign in
  if (!isSignedIn) {
    return (
      <div>
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
          Cloud link
        </h3>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-4 py-3">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            Sign in to share this project via link.
          </p>
        </div>
      </div>
    );
  }

  // State D: not cloud-saved, signed in — prompt to save to cloud
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Cloud link
      </h3>
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-4 py-3">
        <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
          Save to Cloud to share this project via link.
        </p>
        <button
          onClick={onSaveToCloud}
          disabled={isSaving}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-blue-600 text-white hover:bg-blue-500
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-colors"
        >
          {isSaving ? 'Saving...' : 'Save to Cloud'}
        </button>
        {error && (
          <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </div>
  );
}
