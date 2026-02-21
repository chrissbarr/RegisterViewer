import { useState, useMemo } from 'react';
import { Dialog } from './dialog';
import { CopyButton } from './copy-button';
import { useAppState } from '../../context/app-context';
import { buildSnapshotUrl } from '../../utils/snapshot-url';
import { isCloudEnabled } from '../../utils/api-client';
import { useCloudProject } from '../../context/cloud-context';

interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
}

export function ShareDialog({ open, onClose }: ShareDialogProps) {
  const state = useAppState();
  const cloud = useCloudProject();
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);

  const generateUrl = useMemo(() => {
    if (!open) return null;
    try {
      return buildSnapshotUrl(state);
    } catch {
      return null;
    }
  }, [open, state]);

  const currentSnapshotUrl = snapshotUrl ?? generateUrl;
  const charCount = currentSnapshotUrl?.length ?? 0;
  const isUrlLong = charCount > 2000;

  // Regenerate snapshot URL when dialog opens
  useState(() => {
    if (open) {
      try {
        setSnapshotUrl(buildSnapshotUrl(state));
      } catch {
        setSnapshotUrl(null);
      }
    }
  });

  const hasCloudProject = cloud.projectId !== null;
  const cloudUrl = cloud.shareUrl;

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
          {currentSnapshotUrl ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={currentSnapshotUrl}
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-md border
                    border-gray-300 dark:border-gray-600
                    bg-gray-50 dark:bg-gray-900
                    text-gray-700 dark:text-gray-300
                    truncate"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <CopyButton value={currentSnapshotUrl} label="Copy snapshot URL" />
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
        {isCloudEnabled() && hasCloudProject && cloudUrl && (
          <div>
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Cloud link
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              Short, permanent link to the saved project.
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
        )}

        {/* Suggestion when snapshot is too large and no cloud project */}
        {isCloudEnabled() && !hasCloudProject && isUrlLong && (
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-4 py-3">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              The snapshot URL is quite long. Save your project to the cloud first for a short, shareable link.
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
