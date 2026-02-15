import { useEffect, useRef as useReactRef, type RefObject } from 'react';

/**
 * Calls `handler` when a pointerdown event occurs outside the element
 * referenced by `ref`. Listeners are only attached when `enabled` is true.
 *
 * The handler is stored in a ref so the listener is not re-subscribed
 * when the caller passes a new closure on every render.
 */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  handler: () => void,
  enabled: boolean = true,
) {
  const handlerRef = useReactRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    function onPointerDown(e: PointerEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handlerRef.current();
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [ref, handlerRef, enabled]);
}
