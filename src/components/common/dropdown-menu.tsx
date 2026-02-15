import { useState, useRef, useId, useEffect, useCallback } from 'react';
import { useClickOutside } from '../../hooks/use-click-outside';

// ── Menu item types ──────────────────────────────────────────────

export type MenuItem =
  | { kind: 'action'; label: string; onAction: () => void }
  | { kind: 'toggle'; label: string; checked: boolean; onToggle: () => void }
  | { kind: 'separator' };

// ── Props ────────────────────────────────────────────────────────

interface DropdownMenuProps {
  items: MenuItem[];
  triggerLabel: string;
  triggerContent: React.ReactNode;
}

// ── Helpers ──────────────────────────────────────────────────────

function isFocusable(item: MenuItem): item is Exclude<MenuItem, { kind: 'separator' }> {
  return item.kind !== 'separator';
}

function nextFocusableIndex(items: MenuItem[], current: number, direction: 1 | -1): number {
  const len = items.length;
  let idx = current;
  for (let i = 0; i < len; i++) {
    idx = (idx + direction + len) % len;
    if (isFocusable(items[idx])) return idx;
  }
  return current;
}

function firstFocusableIndex(items: MenuItem[]): number {
  return items.findIndex(isFocusable);
}

function lastFocusableIndex(items: MenuItem[]): number {
  for (let i = items.length - 1; i >= 0; i--) {
    if (isFocusable(items[i])) return i;
  }
  return -1;
}

// ── Component ────────────────────────────────────────────────────

export function DropdownMenu({ items, triggerLabel, triggerContent }: DropdownMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const menuId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);
  itemRefs.current.length = items.length;

  // Close on click outside
  useClickOutside(containerRef, () => setIsOpen(false), isOpen);

  // Focus the active item when it changes
  useEffect(() => {
    if (isOpen && activeIndex >= 0) {
      itemRefs.current[activeIndex]?.focus();
    }
  }, [isOpen, activeIndex]);

  const close = useCallback((restoreFocus = true) => {
    setIsOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  function openWithKeyboard() {
    setIsOpen(true);
    setActiveIndex(firstFocusableIndex(items));
  }

  function toggle() {
    if (isOpen) close();
    else {
      setIsOpen(true);
      // Don't set activeIndex — no item highlighted until keyboard nav
    }
  }

  function activateItem(item: MenuItem) {
    if (item.kind === 'action') {
      item.onAction();
      close(false);
    } else if (item.kind === 'toggle') {
      item.onToggle();
      // Keep menu open for toggles
    }
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        openWithKeyboard();
        break;
      case 'Escape':
        if (isOpen) {
          e.preventDefault();
          close();
        }
        break;
    }
  }

  function handleMenuKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        if (activeIndex < 0) setActiveIndex(firstFocusableIndex(items));
        else setActiveIndex(nextFocusableIndex(items, activeIndex, 1));
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        if (activeIndex < 0) setActiveIndex(lastFocusableIndex(items));
        else setActiveIndex(nextFocusableIndex(items, activeIndex, -1));
        break;
      }
      case 'Home': {
        e.preventDefault();
        setActiveIndex(firstFocusableIndex(items));
        break;
      }
      case 'End': {
        e.preventDefault();
        setActiveIndex(lastFocusableIndex(items));
        break;
      }
      case 'Enter':
      case ' ': {
        e.preventDefault();
        if (activeIndex >= 0) activateItem(items[activeIndex]);
        break;
      }
      case 'Escape': {
        e.preventDefault();
        close();
        break;
      }
      case 'Tab': {
        close();
        break;
      }
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        aria-haspopup="true"
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-label={triggerLabel}
        onClick={toggle}
        onKeyDown={handleTriggerKeyDown}
        className="px-2.5 py-1.5 rounded-md text-sm font-medium
          bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200
          hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
      >
        {triggerContent}
      </button>

      {isOpen && (
        <ul
          id={menuId}
          role="menu"
          onKeyDown={handleMenuKeyDown}
          className="absolute right-0 top-full mt-1 min-w-[10rem] py-1
            rounded-md shadow-lg border
            bg-white dark:bg-gray-800
            border-gray-200 dark:border-gray-700
            z-50"
        >
          {items.map((item, i) => {
            if (item.kind === 'separator') {
              return (
                <li
                  key={i}
                  role="separator"
                  className="my-1 border-t border-gray-200 dark:border-gray-700"
                />
              );
            }

            const isActive = activeIndex === i;

            if (item.kind === 'toggle') {
              return (
                <li
                  key={i}
                  ref={(el) => { itemRefs.current[i] = el; }}
                  role="menuitemcheckbox"
                  aria-checked={item.checked}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => activateItem(item)}
                  className={`flex items-center justify-between w-full px-3 py-2
                    text-left text-sm cursor-pointer select-none
                    text-gray-700 dark:text-gray-200
                    focus:outline-none
                    ${isActive
                      ? 'bg-gray-100 dark:bg-gray-700'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                >
                  <span>{item.label}</span>
                  {item.checked && (
                    <span className="text-blue-600 dark:text-blue-400 ml-3" aria-hidden="true">
                      ✓
                    </span>
                  )}
                </li>
              );
            }

            // action item
            return (
              <li
                key={i}
                ref={(el) => { itemRefs.current[i] = el; }}
                role="menuitem"
                tabIndex={isActive ? 0 : -1}
                onClick={() => activateItem(item)}
                className={`w-full px-3 py-2 text-left text-sm cursor-pointer select-none
                  text-gray-700 dark:text-gray-200
                  focus:outline-none
                  ${isActive
                    ? 'bg-gray-100 dark:bg-gray-700'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                  }`}
              >
                {item.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
