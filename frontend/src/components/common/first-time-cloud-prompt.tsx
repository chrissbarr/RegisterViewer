import { ConfirmationDialog } from './confirmation-dialog';

interface FirstTimeCloudPromptProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function FirstTimeCloudPrompt({ open, onClose, onConfirm }: FirstTimeCloudPromptProps) {
  return (
    <ConfirmationDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="Save to Cloud"
      description="Your project will be uploaded to our servers and you'll get a shareable link."
      confirmLabel="Save to Cloud"
      cancelLabel="Cancel"
    >
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 px-4 py-3 mb-2">
        <p className="text-xs text-blue-700 dark:text-blue-300">
          Your browser stores an ownership token. Download a recovery key from &ldquo;My Projects&rdquo; to protect against browser data loss.
        </p>
      </div>
    </ConfirmationDialog>
  );
}
