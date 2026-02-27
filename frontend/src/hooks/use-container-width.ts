import { useRef, useState, useLayoutEffect } from 'react';

/**
 * Returns a ref to attach to a container element and its current content width in pixels.
 * Uses ResizeObserver for responsive measurement.
 */
export function useContainerWidth<T extends HTMLElement = HTMLDivElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
      }
    });

    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}
