import { useState } from 'react';
import { AlertTriangle, CloudDownload, CloudUpload } from 'lucide-react';

interface CloudConflictBannerProps {
  serverVersion: number;
  onKeepLocalVersion: () => Promise<unknown>;
  onLoadServerVersion: () => Promise<void>;
}

export function CloudConflictBanner({
  serverVersion,
  onKeepLocalVersion,
  onLoadServerVersion,
}: CloudConflictBannerProps) {
  const [pendingAction, setPendingAction] = useState<'keep-local' | 'load-server' | null>(null);

  const runAction = async (action: 'keep-local' | 'load-server', fn: () => Promise<unknown>) => {
    setPendingAction(action);
    try {
      await fn();
    } catch {
      // The conflict remains visible; cloud actions own user-facing error state.
    } finally {
      setPendingAction(null);
    }
  };

  const disabled = pendingAction !== null;

  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <AlertTriangle size={16} aria-hidden="true" className="shrink-0" />
      <p className="min-w-0 flex-1">
        Cloud conflict. Another session saved version {serverVersion}; your local edits are preserved.
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => runAction('keep-local', onKeepLocalVersion)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-300 bg-white px-2.5 py-1 font-medium text-amber-950 transition-colors hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900"
        >
          <CloudUpload size={14} aria-hidden="true" />
          {pendingAction === 'keep-local' ? 'Saving...' : 'Keep local'}
        </button>
        <button
          type="button"
          onClick={() => runAction('load-server', onLoadServerVersion)}
          disabled={disabled}
          className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-amber-500 dark:text-amber-950 dark:hover:bg-amber-400"
        >
          <CloudDownload size={14} aria-hidden="true" />
          {pendingAction === 'load-server' ? 'Loading...' : 'Load server'}
        </button>
      </div>
    </div>
  );
}
