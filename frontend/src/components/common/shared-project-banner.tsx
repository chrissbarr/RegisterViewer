import { useState } from 'react';
import { X } from 'lucide-react';
import { useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';

export function SharedProjectBanner() {
  const cloud = useCloudSync();
  const actions = useCloudSyncActions();
  const [dismissed, setDismissed] = useState(false);

  // Only show for non-owner viewing a cloud project
  if (!cloud.cloudId || cloud.isOwner || dismissed) return null;

  const isSaving = cloud.status === 'saving';

  return (
    <div className="flex flex-col gap-1 px-3 py-2.5
      bg-amber-50 dark:bg-amber-950/40
      border border-amber-200 dark:border-amber-800
      rounded-lg
      text-amber-800 dark:text-amber-200 text-sm"
    >
      <div className="flex items-center justify-between">
        <span>Viewing a shared project</span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => actions.fork()}
            disabled={isSaving}
            className="px-2.5 py-0.5 rounded text-xs font-medium
              bg-amber-200 dark:bg-amber-800
              hover:bg-amber-300 dark:hover:bg-amber-700
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            {isSaving ? 'Saving...' : 'Save your own copy'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss banner"
            className="p-0.5 rounded text-amber-600 dark:text-amber-400
              hover:bg-amber-200 dark:hover:bg-amber-800
              transition-colors"
          >
            <X size={14} />
          </button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-amber-700/80 dark:text-amber-300/70">
        Your edits won't affect the original. Save a copy to keep or share your changes.
      </p>
    </div>
  );
}
