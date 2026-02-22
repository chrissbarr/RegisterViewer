import { useMemo, useState, useCallback } from 'react';
import { Dialog } from './dialog';
import { CopyButton } from './copy-button';
import { ConfirmationDialog } from './confirmation-dialog';
import { useAppState } from '../../context/app-context';
import { buildSnapshotUrl } from '../../utils/snapshot-url';
import { isCloudEnabled } from '../../utils/api-client';
import { useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const state = useAppState();
  const cloud = useCloudSync();
  const actions = useCloudSyncActions();
  const [showFirstTimePrompt, setShowFirstTimePrompt] = useState(false);

  const snapshotUrl = useMemo(() => {
    if (!open) return null;
    try {
      return buildSnapshotUrl(state);
    } catch {
      return null;
    }
  }, [open, state]);

  const charCount = snapshotUrl?.length ?? 0;
  const isUrlLong = charCount > 2000;

  const hasCloudProject = cloud.cloudId !== null;
  const cloudUrl = cloud.shareUrl;
  const isSaving = cloud.status === 'saving';

  const handleSaveToCloud = useCallback(() => {
    // Show first-time prompt if project has never been saved to cloud
    if (!hasCloudProject) {
      setShowFirstTimePrompt(true);
      return;
    }
    actions.saveToCloud();
  }, [hasCloudProject, actions]);

  const handleConfirmFirstSave = useCallback(() => {
    setShowFirstTimePrompt(false);
    actions.saveToCloud();
  }, [actions]);

  const handleMakeUnlisted = useCallback(() => {
    actions.setVisibility('unlisted');
  }, [actions]);

  return (
    <>
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
            ) : (
              <p className="text-xs text-red-500">Failed to generate snapshot URL.</p>
            )}
          </div>

          {/* Cloud link section */}
          {isCloudEnabled() && (
            <CloudLinkSection
              hasCloudProject={hasCloudProject}
              cloudUrl={cloudUrl}
              visibility={cloud.visibility}
              isSaving={isSaving}
              onSaveToCloud={handleSaveToCloud}
              onMakeUnlisted={handleMakeUnlisted}
            />
          )}
        </div>
      </Dialog>

      {/* First-time cloud save confirmation */}
      <ConfirmationDialog
        open={showFirstTimePrompt}
        onClose={() => setShowFirstTimePrompt(false)}
        onConfirm={handleConfirmFirstSave}
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
    </>
  );
}

interface CloudLinkSectionProps {
  hasCloudProject: boolean;
  cloudUrl: string | null;
  visibility: 'private' | 'unlisted';
  isSaving: boolean;
  onSaveToCloud: () => void;
  onMakeUnlisted: () => void;
}

function CloudLinkSection({
  hasCloudProject,
  cloudUrl,
  visibility,
  isSaving,
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

  // State C: not cloud-saved — blue callout with "Save to Cloud" button
  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
        Cloud link
      </h3>
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-4 py-3">
        <p className="text-sm text-blue-700 dark:text-blue-300 mb-3">
          Save to the cloud for a short, permanent link.
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
      </div>
    </div>
  );
}
