import { useProjectStorage, useProjectStorageActions } from '../../context/project-storage-context';

export function UnsavedBanner() {
  const { isUnsaved } = useProjectStorage();
  const { saveCurrentProject } = useProjectStorageActions();

  if (!isUnsaved) return null;

  return (
    <div
      className="flex items-center justify-between px-4 py-2
        bg-amber-50 dark:bg-amber-900/20
        border-b border-amber-200 dark:border-amber-700
        text-amber-800 dark:text-amber-200 text-sm"
      role="status"
    >
      <span>
        This project is unsaved. It won&apos;t appear in My Projects until you save it.
      </span>
      <button
        onClick={() => saveCurrentProject()}
        className="px-3 py-1 rounded-md text-sm font-medium
          bg-amber-600 text-white hover:bg-amber-700
          transition-colors shrink-0 ml-4"
      >
        Save Project
      </button>
    </div>
  );
}
