import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { useClickOutside } from '../../hooks/use-click-outside';
import type { Visibility } from '../../types/project';

interface VisibilityBadgeProps {
  visibility: Visibility;
  isCloudSaved: boolean;
  onChangeVisibility?: (v: Visibility) => void;
  projectName: string;
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; description: string }[] = [
  { value: 'private', label: 'Private', description: 'Only you can access' },
  { value: 'unlisted', label: 'Unlisted', description: 'Anyone with the link can view' },
];

/** Visibility indicator badge. Clickable for cloud projects to change visibility. */
export function VisibilityBadge({
  visibility,
  isCloudSaved,
  onChangeVisibility,
  projectName,
}: VisibilityBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useClickOutside(containerRef, () => setIsOpen(false), isOpen);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const canChange = isCloudSaved && onChangeVisibility;
  const badgeColors = visibility === 'unlisted'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400'
    : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';

  if (!canChange) {
    return (
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${badgeColors}`}
        title={isCloudSaved ? undefined : 'Save to cloud to set visibility'}
      >
        {visibility === 'unlisted' ? 'Unlisted' : 'Private'}
      </span>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        ref={triggerRef}
        onClick={() => setIsOpen(!isOpen)}
        aria-label={`Visibility: ${visibility} for ${projectName}. Click to change.`}
        aria-haspopup="true"
        aria-expanded={isOpen}
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium cursor-pointer
          hover:ring-1 hover:ring-gray-300 dark:hover:ring-gray-500 transition-all ${badgeColors}`}
      >
        {visibility === 'unlisted' ? 'Unlisted' : 'Private'}
        <ChevronDown size={12} className="ml-0.5" />
      </button>

      {isOpen && (
        <div
          role="radiogroup"
          aria-label={`Visibility options for ${projectName}`}
          className="absolute top-full left-0 mt-1 w-56 py-1 rounded-md shadow-lg border z-50
            bg-white dark:bg-gray-800
            border-gray-200 dark:border-gray-700"
        >
          {VISIBILITY_OPTIONS.map((option) => {
            const isSelected = visibility === option.value;
            return (
              <button
                key={option.value}
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  onChangeVisibility(option.value);
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                className={`w-full px-3 py-2 text-left text-sm cursor-pointer
                  hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors
                  ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-700 dark:text-gray-200'}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`w-3 h-3 rounded-full border-2 flex items-center justify-center shrink-0
                    ${isSelected
                      ? 'border-blue-600 dark:border-blue-400'
                      : 'border-gray-400 dark:border-gray-500'
                    }`}
                  >
                    {isSelected && (
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-blue-400" />
                    )}
                  </span>
                  <div>
                    <div className="font-medium">{option.label}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{option.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
