import { useState, useCallback, useRef } from 'react';
import { useProjectStorage } from '../context/project-storage-context';

type PendingAction = () => void;

interface UnsavedGuardResult {
  /**
   * Wrap a navigation action. If the project is unsaved, queues the
   * action and shows the prompt. If saved, executes immediately.
   */
  guard: (action: PendingAction) => void;

  /** Whether the save/discard/cancel prompt should be shown. */
  promptOpen: boolean;

  /** Execute the queued action (after save or discard). */
  executePending: () => void;

  /** Cancel the queued action (user chose "Cancel"). */
  cancelPending: () => void;
}

export function useUnsavedGuard(): UnsavedGuardResult {
  const { isUnsaved } = useProjectStorage();
  const [promptOpen, setPromptOpen] = useState(false);
  const pendingRef = useRef<PendingAction | null>(null);

  const guard = useCallback((action: PendingAction) => {
    if (isUnsaved) {
      pendingRef.current = action;
      setPromptOpen(true);
    } else {
      action();
    }
  }, [isUnsaved]);

  const executePending = useCallback(() => {
    setPromptOpen(false);
    const action = pendingRef.current;
    pendingRef.current = null;
    action?.();
  }, []);

  const cancelPending = useCallback(() => {
    setPromptOpen(false);
    pendingRef.current = null;
  }, []);

  return { guard, promptOpen, executePending, cancelPending };
}
