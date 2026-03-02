import { useRef, useEffect } from 'react';

interface DeleteConfirmationProps {
  projectName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Inline Confirm/Cancel expansion for project deletion.
 * Replaces the delete icon button with explicit Delete + Cancel buttons.
 * Focus moves to Cancel button (safe default).
 */
export function DeleteConfirmation({
  projectName,
  onConfirm,
  onCancel,
}: DeleteConfirmationProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus Cancel button on mount (safe default)
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const description = 'Delete this project?';

  return (
    <div
      role="alertdialog"
      aria-label={`Confirm deletion of ${projectName}`}
      className="flex flex-col items-end gap-1.5"
    >
      <span className="text-xs text-gray-500 dark:text-gray-400 text-right">
        {description}
      </span>
      <div className="flex items-center gap-1">
        <button
          onClick={onConfirm}
          aria-label={`Delete project ${projectName}`}
          className="px-2 py-1 rounded text-xs font-medium whitespace-nowrap
            bg-red-600 text-white hover:bg-red-700
            transition-colors"
        >
          Delete
        </button>
        <button
          ref={cancelRef}
          onClick={onCancel}
          aria-label="Cancel deletion"
          className="px-2 py-1 rounded text-xs font-medium whitespace-nowrap
            bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200
            hover:bg-gray-300 dark:hover:bg-gray-500
            transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
