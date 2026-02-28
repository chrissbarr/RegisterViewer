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
          Sign in with your email to keep access to your projects across devices and browsers.
        </p>
      </div>
    </ConfirmationDialog>
  );
}
