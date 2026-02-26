import { FirstTimeCloudPrompt } from '../common/first-time-cloud-prompt';
import { ConfirmationDialog } from '../common/confirmation-dialog';
import { Toast } from '../common/toast';

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
        <Toast
          message={cloudError}
          variant="error"
          duration={5000}
          onDismiss={onDismissCloudError}
        />
      )}
    </>
  );
}
