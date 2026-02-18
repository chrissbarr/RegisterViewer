import { Dialog } from './dialog';

interface ConfirmClearDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmClearDialog({ open, onClose, onConfirm }: ConfirmClearDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Clear Workspace">
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        This will remove all registers and their values. This action cannot be undone.
      </p>
      <div className="flex gap-2 justify-end">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200
            hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-red-600 text-white hover:bg-red-700 transition-colors"
        >
          Clear
        </button>
      </div>
    </Dialog>
  );
}
