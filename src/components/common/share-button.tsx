import { useState } from 'react';
import { ShareDialog } from './share-dialog';

function ShareIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" className="block">
      <path d="M7.775 3.275a.75.75 0 0 0 1.06 1.06l1.25-1.25a2 2 0 1 1 2.83 2.83l-2.5 2.5a2 2 0 0 1-2.83 0 .75.75 0 0 0-1.06 1.06 3.5 3.5 0 0 0 4.95 0l2.5-2.5a3.5 3.5 0 0 0-4.95-4.95l-1.25 1.25Zm-.025 9.45a.75.75 0 0 0-1.06-1.06l-1.25 1.25a2 2 0 0 1-2.83-2.83l2.5-2.5a2 2 0 0 1 2.83 0 .75.75 0 1 0 1.06-1.06 3.5 3.5 0 0 0-4.95 0l-2.5 2.5a3.5 3.5 0 0 0 4.95 4.95l1.25-1.25Z" />
    </svg>
  );
}

export function ShareButton() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setDialogOpen(true)}
        title="Share"
        aria-label="Share"
        className="px-2.5 py-1.5 rounded-md text-sm font-medium
          bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
          hover:bg-gray-300 dark:hover:bg-gray-600
          transition-colors"
      >
        <ShareIcon />
      </button>
      <ShareDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
