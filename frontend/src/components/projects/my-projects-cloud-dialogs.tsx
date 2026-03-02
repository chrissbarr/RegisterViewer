import { ConfirmationDialog } from '../common/confirmation-dialog';
import { Toast } from '../common/toast';

interface MyProjectsCloudDialogsProps {
  isDeleteCloudConfirmOpen: boolean;
  onDismissDeleteCloudConfirm: () => void;
  onConfirmCloudDelete: () => void;
  cloudError: string | null;
  onDismissCloudError: () => void;
}

export function MyProjectsCloudDialogs({
  isDeleteCloudConfirmOpen,
  onDismissDeleteCloudConfirm,
  onConfirmCloudDelete,
  cloudError,
  onDismissCloudError,
}: MyProjectsCloudDialogsProps) {
  return (
    <>
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
