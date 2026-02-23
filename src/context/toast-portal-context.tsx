import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type RegisterFn = () => () => void;

const ToastPortalContext = createContext<{ target: HTMLElement | null; register: RegisterFn }>({
  target: null,
  register: () => () => {},
});

/**
 * Provides a top-layer toast container that renders above `<dialog>` backdrops.
 *
 * When a Dialog is open, a `<div popover="manual">` is shown in the browser's
 * top layer (inserted after the dialog, so it stacks above the dialog's ::backdrop).
 * Toasts portal into this popover so they aren't dimmed by the backdrop overlay.
 * When no dialog is open, toasts fall back to `document.body` as usual.
 */
export function ToastPortalProvider({ children }: { children: ReactNode }) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const depthRef = useRef(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);

  const register = useCallback<RegisterFn>(() => {
    depthRef.current++;
    // Defer showPopover to the next microtask so the dialog's showModal() runs first,
    // ensuring the popover is inserted into the top layer AFTER the dialog.
    queueMicrotask(() => {
      const el = popoverRef.current;
      if (el && typeof el.showPopover === 'function') {
        try { el.showPopover(); } catch { /* already shown */ }
        setTarget(el);
      }
    });
    return () => {
      depthRef.current = Math.max(0, depthRef.current - 1);
      if (depthRef.current === 0) {
        try { popoverRef.current?.hidePopover(); } catch { /* already hidden */ }
        setTarget(null);
      }
    };
  }, []);

  const value = useMemo(() => ({ target, register }), [target, register]);

  return (
    <ToastPortalContext.Provider value={value}>
      {children}
      {createPortal(
        <div
          ref={popoverRef}
          popover="manual"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'transparent',
            border: 'none',
            padding: 0,
            margin: 0,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        />,
        document.body,
      )}
    </ToastPortalContext.Provider>
  );
}

export function useToastPortalTarget() {
  return useContext(ToastPortalContext).target;
}

export function useToastPortalRegister() {
  return useContext(ToastPortalContext).register;
}
