import { useRef } from 'react';
import { Dialog } from './dialog';
import { useProjectStorageActions } from '../../context/project-storage-context';
import { clearUnsavedProject } from '../../utils/project-storage';

interface UnsavedPromptDialogProps {
  open: boolean;
  onSaveAndContinue: () => void;
  onDiscardAndContinue: () => void;
  onCancel: () => void;
}

export function UnsavedPromptDialog({
  open,
  onSaveAndContinue,
  onDiscardAndContinue,
  onCancel,
}: UnsavedPromptDialogProps) {
  const { saveCurrentProject } = useProjectStorageActions();
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  function handleSave() {
    saveCurrentProject();
    onSaveAndContinue();
  }

  function handleDiscard() {
    clearUnsavedProject();
    onDiscardAndContinue();
  }

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="Unsaved Project"
      role="alertdialog"
      maxWidth="max-w-sm"
      initialFocusRef={saveButtonRef}
    >
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
        You have an unsaved project. Would you like to save it before continuing?
      </p>
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 rounded-md text-sm
            text-gray-600 dark:text-gray-300
            hover:bg-gray-100 dark:hover:bg-gray-700
            transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleDiscard}
          className="px-3 py-1.5 rounded-md text-sm
            text-red-600 dark:text-red-400
            hover:bg-red-50 dark:hover:bg-red-900/20
            transition-colors"
        >
          Discard
        </button>
        <button
          ref={saveButtonRef}
          onClick={handleSave}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-blue-600 text-white hover:bg-blue-500
            transition-colors"
        >
          Save
        </button>
      </div>
    </Dialog>
  );
}
