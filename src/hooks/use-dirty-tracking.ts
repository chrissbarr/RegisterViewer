import { useRef, useState, useEffect, type MutableRefObject } from 'react';

interface DataDeps {
  registers: unknown;
  registerValues: unknown;
  project?: unknown;
  addressUnitBits?: unknown;
}

interface InternalSlice {
  cloudId: string | null;
  lastSavedVersion: number;
}

type StateSetter<T> = (updater: (prev: T) => T) => void;

interface DirtyTrackingResult {
  isDirty: boolean;
  dataVersionRef: MutableRefObject<number>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  mutationLockRef: MutableRefObject<boolean>;
}

/**
 * Generation-counter dirty tracking for cloud sync.
 *
 * Increments a version counter whenever app-state data deps change.
 * Compares the current version against the last-saved version to
 * derive `isDirty`. Only triggers a re-render when the dirty status
 * actually flips (false→true or true→false).
 *
 * The setState-in-effect pattern is intentional here: we must compare the
 * ref-based version counter (which can't trigger renders) against the
 * last-saved version (from state) and only re-render when dirty status
 * actually changes. This avoids re-rendering on every keystroke.
 */
export function useDirtyTracking<T extends InternalSlice>(
  dataDeps: DataDeps,
  internal: T,
  setInternal: StateSetter<T>,
): DirtyTrackingResult {
  const mutationLockRef = useRef(false);
  const dataVersionRef = useRef(0);
  const needsVersionSyncRef = useRef(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    dataVersionRef.current++;

    if (needsVersionSyncRef.current) {
      needsVersionSyncRef.current = false;
      const capturedVersion = dataVersionRef.current;
      setInternal((prev) => ({ ...prev, lastSavedVersion: capturedVersion }));
      return;
    }

    // Only trigger a re-render when isDirty status actually changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: ref-based version counter must sync to state
    setIsDirty(internal.cloudId !== null
      && internal.lastSavedVersion >= 0
      && dataVersionRef.current !== internal.lastSavedVersion);
  }, [dataDeps.registers, dataDeps.registerValues, dataDeps.project, dataDeps.addressUnitBits, internal.cloudId, internal.lastSavedVersion, setInternal]);

  return { isDirty, dataVersionRef, needsVersionSyncRef, mutationLockRef };
}
