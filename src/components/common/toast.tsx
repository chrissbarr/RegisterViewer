import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CircleCheck, OctagonAlert, Info } from 'lucide-react';
import { useToastPortalTarget } from '../../context/toast-portal-context';

interface ToastProps {
  message: string;
  variant?: 'success' | 'info' | 'error';
  duration?: number;
  onDismiss: () => void;
}

export function Toast({ message, variant = 'success', duration = 3000, onDismiss }: ToastProps) {
  const portalTarget = useToastPortalTarget();
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

  const IconComponent = variant === 'success'
    ? CircleCheck
    : variant === 'error'
      ? OctagonAlert
      : Info;

  const iconColor = variant === 'success'
    ? 'text-green-400'
    : variant === 'error'
      ? 'text-red-400'
      : 'text-blue-400';

  return createPortal(
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      aria-live={variant === 'error' ? 'assertive' : 'polite'}
      className={`fixed top-4 right-4 z-50 max-w-sm w-full pointer-events-auto
        transition-all duration-200 ease-out
        ${visible ? 'translate-x-0 opacity-100' : 'translate-x-4 opacity-0'}`}
    >
      <div className="flex overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg shadow-black/10 dark:shadow-black/30">
        <div className={`w-1 shrink-0 ${accentColor}`} />
        <div className="flex items-center gap-3 px-4 py-3">
          <IconComponent size={20} className={`shrink-0 ${iconColor}`} />
          <p className="text-sm text-gray-700 dark:text-gray-200">{message}</p>
        </div>
      </div>
    </div>,
    portalTarget ?? document.body,
  );
}
