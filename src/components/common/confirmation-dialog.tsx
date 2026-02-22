import { useRef, useEffect, useId, type ReactNode } from 'react';
import { Dialog } from './dialog';

interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'primary' | 'destructive';
}

export function ConfirmationDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  children,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'primary',
}: ConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();

  // Auto-focus: cancel for destructive, confirm for primary
  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      if (variant === 'destructive') {
        cancelRef.current?.focus();
      } else {
        confirmRef.current?.focus();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [open, variant]);

  const confirmColors = variant === 'destructive'
    ? 'bg-red-600 text-white hover:bg-red-700'
    : 'bg-blue-600 text-white hover:bg-blue-500';

  return (
    <Dialog open={open} onClose={onClose} title={title} role="alertdialog" aria-describedby={description ? descriptionId : undefined}>
      {description && (
        <p id={descriptionId} className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          {description}
        </p>
      )}
      {children}
      <div className="flex gap-2 justify-end mt-4">
        <button
          ref={cancelRef}
          onClick={onClose}
          className="px-3 py-1.5 rounded-md text-sm font-medium
            bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200
            hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        >
          {cancelLabel}
        </button>
        <button
          ref={confirmRef}
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${confirmColors}`}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
