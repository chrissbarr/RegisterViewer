import { useState } from 'react';
import { Link } from 'lucide-react';
import { ShareDialog } from './share-dialog';

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
        <Link size={16} className="block" />
      </button>
      <ShareDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </>
  );
}
