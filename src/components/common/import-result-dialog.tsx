import { TriangleAlert, CircleX } from 'lucide-react';
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
        {variant === 'error'
          ? <CircleX size={24} className="shrink-0 text-red-400" />
          : <TriangleAlert size={24} className="shrink-0 text-amber-400" />}
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
