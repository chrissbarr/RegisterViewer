import { useState } from 'react';

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
      className="flex flex-col gap-1 px-3 py-2.5
        bg-amber-50 dark:bg-amber-950/40
        border border-amber-200 dark:border-amber-800
        rounded-lg
        text-amber-800 dark:text-amber-200 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Cloud conflict</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => runAction('keep-local', onKeepLocalVersion)}
            disabled={disabled}
            className="px-2.5 py-0.5 rounded text-xs font-medium
              bg-amber-200 dark:bg-amber-800
              hover:bg-amber-300 dark:hover:bg-amber-700
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            {pendingAction === 'keep-local' ? 'Saving...' : 'Keep local'}
          </button>
          <button
            type="button"
            onClick={() => runAction('load-server', onLoadServerVersion)}
            disabled={disabled}
            className="px-2.5 py-0.5 rounded text-xs font-medium
              bg-amber-200 dark:bg-amber-800
              hover:bg-amber-300 dark:hover:bg-amber-700
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors"
          >
            {pendingAction === 'load-server' ? 'Loading...' : 'Load server'}
          </button>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-amber-700/80 dark:text-amber-300/70">
        Another session saved version {serverVersion}; your local edits are preserved.
      </p>
    </div>
  );
}
