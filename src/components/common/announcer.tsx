import { createContext, useContext, useCallback, useRef, useState, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Politeness = 'polite' | 'assertive';

interface AnnounceOptions {
  politeness?: Politeness;
}

interface AnnouncerContextValue {
  announce: (message: string, options?: AnnounceOptions) => void;
}

const AnnouncerContext = createContext<AnnouncerContextValue | null>(null);

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [politeMessage, setPoliteMessage] = useState('');
  const [assertiveMessage, setAssertiveMessage] = useState('');
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((message: string, options?: AnnounceOptions) => {
    const politeness = options?.politeness ?? 'polite';

    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
    }

    // Clear then set to force screen readers to re-announce even if same message
    if (politeness === 'assertive') {
      setAssertiveMessage('');
      requestAnimationFrame(() => setAssertiveMessage(message));
    } else {
      setPoliteMessage('');
      requestAnimationFrame(() => setPoliteMessage(message));
    }

    clearTimerRef.current = setTimeout(() => {
      setPoliteMessage('');
      setAssertiveMessage('');
    }, 5000);
  }, []);

  const value = useMemo(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      {createPortal(
        <>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="sr-only"
          >
            {politeMessage}
          </div>
          <div
            role="alert"
            aria-live="assertive"
            aria-atomic="true"
            className="sr-only"
          >
            {assertiveMessage}
          </div>
        </>,
        document.body,
      )}
    </AnnouncerContext.Provider>
  );
}

export function useAnnounce(): (message: string, options?: AnnounceOptions) => void {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) throw new Error('useAnnounce must be used within AnnouncerProvider');
  return ctx.announce;
}
