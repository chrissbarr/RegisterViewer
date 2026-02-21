import { useState } from 'react';
import { useCloudProject, useCloudActions } from '../../context/cloud-context';

export function SharedProjectBanner() {
  const cloud = useCloudProject();
  const actions = useCloudActions();
  const [dismissed, setDismissed] = useState(false);

  // Only show for non-owner viewing a cloud project
  if (!cloud.projectId || cloud.isOwner || dismissed) return null;

  const isSaving = cloud.status === 'saving';

  return (
    <div className="flex items-center justify-between px-4 py-1.5
      bg-amber-50 dark:bg-amber-950/40
      border-b border-amber-200 dark:border-amber-800
      text-amber-800 dark:text-amber-200 text-sm"
    >
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
          <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
            <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
          </svg>
        </button>
      </div>
    </div>
  );
}
