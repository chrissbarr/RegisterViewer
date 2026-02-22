import { useRef, useEffect } from 'react';

interface DeleteConfirmationProps {
  projectName: string;
  isCloudSaved: boolean;
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
  isCloudSaved,
  onConfirm,
  onCancel,
}: DeleteConfirmationProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus Cancel button on mount (safe default)
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  const description = isCloudSaved
    ? 'This will delete the local copy and remove it from the cloud. Shared links will stop working.'
    : 'This will permanently delete this project.';

  return (
    <div
      role="alertdialog"
      aria-label={`Confirm deletion of ${projectName}`}
      className="flex items-center gap-1"
    >
      <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">
        {description}
      </span>
      <button
        onClick={onConfirm}
        aria-label={`Delete project ${projectName}`}
        className="px-2 py-1 rounded text-xs font-medium
          bg-red-600 text-white hover:bg-red-700
          transition-colors"
      >
        Delete
      </button>
      <button
        ref={cancelRef}
        onClick={onCancel}
        aria-label="Cancel deletion"
        className="px-2 py-1 rounded text-xs font-medium
          bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200
          hover:bg-gray-300 dark:hover:bg-gray-500
          transition-colors"
      >
        Cancel
      </button>
    </div>
  );
}
