import { Dialog } from './dialog';
import type { ImportWarning } from '../../utils/storage';

interface ImportResultDialogProps {
  open: boolean;
  onClose: () => void;
  variant: 'warning' | 'error';
  importedCount: number;
  skippedCount: number;
  warnings: ImportWarning[];
  errorMessage?: string;
}

function WarningIcon() {
  return (
    <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor" className="shrink-0 text-amber-400">
      <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm1 6a1 1 0 1 0-2 0 1 1 0 0 0 2 0Z" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor" className="shrink-0 text-red-400">
      <path d="M2.343 13.657A8 8 0 1 1 13.658 2.343 8 8 0 0 1 2.343 13.657ZM6.03 4.97a.75.75 0 0 0-1.06 1.06L6.94 8 4.97 9.97a.75.75 0 1 0 1.06 1.06L8 9.06l1.97 1.97a.75.75 0 1 0 1.06-1.06L9.06 8l1.97-1.97a.75.75 0 0 0-1.06-1.06L8 6.94Z" />
    </svg>
  );
}

export function ImportResultDialog({
  open,
  onClose,
  variant,
  importedCount,
  skippedCount,
  warnings,
  errorMessage,
}: ImportResultDialogProps) {
  const title = variant === 'error' ? 'Import Failed' : 'Import Completed with Warnings';

  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <div className="flex items-start gap-3 mb-4">
        {variant === 'error' ? <ErrorIcon /> : <WarningIcon />}
        <p className="text-sm text-gray-500 dark:text-gray-300">
          {variant === 'error'
            ? (errorMessage ?? 'Failed to import: invalid JSON or missing registers array.')
            : `${importedCount} register${importedCount !== 1 ? 's' : ''} imported successfully. ${skippedCount} skipped due to validation errors:`}
        </p>
      </div>

      {variant === 'warning' && warnings.length > 0 && (
        <div className="max-h-60 overflow-y-auto space-y-2 mb-4">
          {warnings.map((w, i) => (
            <div key={i} className="rounded-md bg-gray-100 dark:bg-gray-900/60 px-3 py-2">
              <p className="font-mono text-sm text-amber-700 dark:text-amber-300">{w.registerName}</p>
              {w.errors.map((e, j) => (
                <p key={j} className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{e.message}</p>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className={`px-4 py-1.5 rounded-md text-sm font-medium text-white transition-colors ${
            variant === 'error'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-amber-600 hover:bg-amber-500'
          }`}
        >
          Got it
        </button>
      </div>
    </Dialog>
  );
}
