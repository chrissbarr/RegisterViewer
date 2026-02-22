import { useState, useRef, useEffect, useCallback } from 'react';

interface InlineRenameProps {
  name: string;
  onRename: (newName: string) => void;
  projectName: string;
}

/**
 * Click-to-edit name component.
 * Non-editing: renders a <button> styled as text (accessible, focusable).
 * Editing: renders an <input>. Enter commits, Escape cancels.
 * Negative margin trick prevents layout shift.
 */
export function InlineRename({ name, onRename, projectName }: InlineRenameProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.select();
    }
  }, [isEditing]);

  const commitRename = useCallback(() => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    } else {
      setDraft(name);
    }
    setIsEditing(false);
    // Restore focus to the button after committing
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, [draft, name, onRename]);

  const cancelRename = useCallback(() => {
    setDraft(name);
    setIsEditing(false);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }, [name]);

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitRename();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelRename();
          }
        }}
        onBlur={commitRename}
        aria-label={`Rename project ${projectName}`}
        className="text-sm font-medium text-gray-800 dark:text-gray-200
          bg-transparent border border-blue-400 dark:border-blue-500
          rounded px-1 py-0 -mx-1 -my-0.5
          outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500
          w-full max-w-[20rem]"
      />
    );
  }

  return (
    <button
      ref={buttonRef}
      onClick={() => {
        setDraft(name);
        setIsEditing(true);
      }}
      aria-label={`Rename project ${projectName}`}
      title="Click to rename"
      className="text-sm font-medium text-gray-800 dark:text-gray-200
        truncate text-left cursor-pointer
        hover:underline hover:decoration-gray-400 dark:hover:decoration-gray-500
        rounded -mx-1 px-1 -my-0.5 py-0
        focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500"
    >
      {name || 'Untitled Project'}
    </button>
  );
}
