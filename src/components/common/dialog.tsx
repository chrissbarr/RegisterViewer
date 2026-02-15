import { useRef, useEffect, useId, type ReactNode } from 'react';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export function Dialog({ open, onClose, title, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open && !el.open) {
      // Guard for jsdom which doesn't implement showModal
      if (typeof el.showModal === 'function') {
        el.showModal();
      } else {
        el.setAttribute('open', '');
      }
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  function handleClose() {
    onClose();
  }

  function handleClick(e: React.MouseEvent<HTMLDialogElement>) {
    // Clicks on the <dialog> itself (backdrop area) close it
    if (e.target === dialogRef.current) {
      onClose();
    }
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={handleClose}
      onClick={handleClick}
      aria-labelledby={titleId}
      className="backdrop:bg-black/50 dark:backdrop:bg-black/70
        bg-white dark:bg-gray-800
        text-gray-900 dark:text-gray-100
        border border-gray-200 dark:border-gray-700
        rounded-xl shadow-xl
        p-0 m-auto
        max-w-lg w-[calc(100%-2rem)]
        max-h-[calc(100vh-4rem)]
        overflow-hidden"
    >
      {open && (
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
              <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor" className="block">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">
            {children}
          </div>
        </div>
      )}
    </dialog>
  );
}
