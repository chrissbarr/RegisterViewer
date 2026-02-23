import { FirstTimeCloudPrompt } from '../common/first-time-cloud-prompt';
import { ConfirmationDialog } from '../common/confirmation-dialog';

interface MyProjectsCloudDialogsProps {
  isSaveToCloudOpen: boolean;
  onDismissSaveToCloud: () => void;
  onConfirmSaveToCloud: () => void;
  isDeleteCloudConfirmOpen: boolean;
  onDismissDeleteCloudConfirm: () => void;
  onConfirmCloudDelete: () => void;
  cloudError: string | null;
  onDismissCloudError: () => void;
}

export function MyProjectsCloudDialogs({
  isSaveToCloudOpen,
  onDismissSaveToCloud,
  onConfirmSaveToCloud,
  isDeleteCloudConfirmOpen,
  onDismissDeleteCloudConfirm,
  onConfirmCloudDelete,
  cloudError,
  onDismissCloudError,
}: MyProjectsCloudDialogsProps) {
  return (
    <>
      {/* First-time cloud save confirmation */}
      <FirstTimeCloudPrompt
        open={isSaveToCloudOpen}
        onClose={onDismissSaveToCloud}
        onConfirm={onConfirmSaveToCloud}
      />

      {/* Cloud delete confirmation dialog */}
      <ConfirmationDialog
        open={isDeleteCloudConfirmOpen}
        onClose={onDismissDeleteCloudConfirm}
        onConfirm={onConfirmCloudDelete}
        title="Remove from Cloud"
        description="This will delete the cloud copy. Shared links will stop working. Your local copy will remain."
        confirmLabel="Remove from Cloud"
        cancelLabel="Cancel"
        variant="destructive"
      />

      {/* Cloud error toast */}
      {cloudError && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg
            bg-red-600 text-white text-sm font-medium
            animate-in fade-in slide-in-from-bottom-2"
        >
          {cloudError}
          <button
            onClick={onDismissCloudError}
            className="ml-3 text-white/80 hover:text-white"
            aria-label="Dismiss error"
          >
            &times;
          </button>
        </div>
      )}
    </>
  );
}
