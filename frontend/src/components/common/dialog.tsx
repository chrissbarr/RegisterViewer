import { useRef, useEffect, useId, useCallback, type ReactNode, type RefObject } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useToastPortalRegister } from '../../context/toast-portal-context';

const DIALOG_ANIMATION_MS = 150;

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  role?: 'dialog' | 'alertdialog';
  'aria-describedby'?: string;
}

export function Dialog({ open, onClose, title, children, maxWidth = 'max-w-lg', initialFocusRef, role = 'dialog', 'aria-describedby': ariaDescribedBy }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const registerPortal = useToastPortalRegister();

  // Signal that a dialog is open so toasts render in the top-layer popover
  useEffect(() => {
    if (!open) return;
    return registerPortal();
  }, [open, registerPortal]);

  // Open the native dialog when `open` becomes true
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      if (typeof el.showModal === 'function') {
        el.showModal();
      } else {
        el.setAttribute('open', '');
      }
      if (initialFocusRef?.current) {
        requestAnimationFrame(() => initialFocusRef.current?.focus());
      }
    }
  }, [open, initialFocusRef]);

  // Close the native dialog after exit animation completes
  const handleExitComplete = useCallback(() => {
    const el = dialogRef.current;
    if (el?.open) el.close();
  }, []);

  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === dialogRef.current) {
      onClose();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onClick={handleClick}
      role={role}
      aria-labelledby={titleId}
      aria-describedby={ariaDescribedBy}
      aria-modal="true"
      className={`backdrop:bg-black/50 dark:backdrop:bg-black/70
        bg-transparent border-none shadow-none p-0 m-auto
        ${maxWidth} w-[calc(100%-2rem)]
        max-h-[calc(100vh-4rem)]
        overflow-hidden`}
    >
      <AnimatePresence onExitComplete={handleExitComplete}>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: DIALOG_ANIMATION_MS / 1000, ease: 'easeOut' }}
            className="bg-white dark:bg-gray-800
              text-gray-900 dark:text-gray-100
              border border-gray-200 dark:border-gray-700
              rounded-xl shadow-xl
              overflow-hidden"
          >
            <div className="flex flex-col max-h-[calc(100vh-4rem)]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
                <h2 id={titleId} className="text-lg font-bold">
                  {title}
                </h2>
                <button
                  onClick={onClose}
                  aria-label="Close dialog"
                  className="p-1 rounded-md text-gray-400 hover:text-gray-600
                    dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700
                    transition-colors"
                >
                  <X size={16} className="block" />
                </button>
              </div>
              <div className="overflow-y-auto px-5 py-4">
                {children}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </dialog>
  );
}
