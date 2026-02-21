import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ToastProps {
  message: string;
  variant?: 'success' | 'info' | 'error';
  duration?: number;
  onDismiss: () => void;
}

export function Toast({ message, variant = 'success', duration = 3000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation on next frame
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let inner: ReturnType<typeof setTimeout>;
    const outer = setTimeout(() => {
      setVisible(false);
      inner = setTimeout(onDismiss, 200);
    }, duration);
    return () => {
      clearTimeout(outer);
      clearTimeout(inner);
    };
  }, [duration, onDismiss]);

  const accentColor = variant === 'success'
    ? 'bg-green-500'
    : variant === 'error'
      ? 'bg-red-500'
      : 'bg-blue-500';

  const iconPath = variant === 'success'
    ? 'M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0Z'
    : variant === 'error'
      ? 'M4.47.22A.749.749 0 0 1 5 0h6c.199 0 .389.079.53.22l4.25 4.25c.141.14.22.331.22.53v6a.749.749 0 0 1-.22.53l-4.25 4.25A.749.749 0 0 1 11 16H5a.749.749 0 0 1-.53-.22L.22 11.53A.749.749 0 0 1 0 11V5c0-.199.079-.389.22-.53Zm.84 1.28L1.5 5.31v5.38l3.81 3.81h5.38l3.81-3.81V5.31L10.69 1.5ZM8 4a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 8 4Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z'
      : 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13ZM7.25 5a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0V5Zm.75 6.25a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Z';

  const iconColor = variant === 'success'
    ? 'text-green-400'
    : variant === 'error'
      ? 'text-red-400'
      : 'text-blue-400';

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className={`fixed top-4 right-4 z-50 max-w-sm w-full
        transition-all duration-200 ease-out
        ${visible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
    >
      <div className="flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg shadow-black/10 dark:shadow-black/30">
        <div className={`w-1 shrink-0 ${accentColor}`} />
        <div className="flex items-center gap-3 px-4 py-3">
          <svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" className={`shrink-0 ${iconColor}`}>
            <path d={iconPath} />
          </svg>
          <p className="text-sm text-gray-700 dark:text-gray-200">{message}</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
