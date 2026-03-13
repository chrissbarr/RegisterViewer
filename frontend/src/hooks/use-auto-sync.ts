import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { CLOUD_SYNC_DEBOUNCE_MS } from '../constants';
import type { AutoSyncInternalSlice } from '../types/cloud-sync';
import type { AppState } from '../types/register';

/**
 * Cloud auto-sync status for the active project.
 * - `saved`: cloud is up to date with local state
 * - `syncing`: a cloud save is in progress
 * - `offline`: last sync attempt failed (network/server error)
 * - `local-only`: project is not cloud-backed (no auto-sync)
 */
export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'local-only';

interface UseAutoSyncDeps {
  isDirty: boolean;
  internalRef: MutableRefObject<AutoSyncInternalSlice>;
  dataVersionRef: MutableRefObject<number>;
  canAutoSync: boolean;
  getJwt: () => string | null;
  saveToCloud: (stateOverride?: AppState) => Promise<boolean>;
}

interface UseAutoSyncResult {
  syncStatus: SyncStatus;
  /** Flush pending cloud sync immediately. When `stateOverride` is provided
   *  it is forwarded to `saveToCloud` so the caller can supply a snapshot of
   *  the *previous* project's state (used by flush-before-evict). */
  flushSync: (stateOverride?: AppState) => Promise<void>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
}

/**
 * Derive sync status from inputs and an async override.
 *
 * Priority: `!canAutoSync` → local-only; `syncing` always shows (active save);
 * `!isDirty` → saved (overrides stale 'offline'); `isDirty + offline` → offline.
 *
 * Note (BP-4): During the debounce window (isDirty but timer hasn't fired),
 * this returns 'saved' rather than a 'pending' status. This is intentional:
 * showing "pending" for every keystroke during the 3s debounce would create
 * visual noise. The brief inaccuracy is acceptable UX.
 */
export function deriveSyncStatus(canAutoSync: boolean, isDirty: boolean, asyncOverride: 'syncing' | 'offline' | null): SyncStatus {
  if (!canAutoSync) return 'local-only';
  if (asyncOverride === 'syncing') return 'syncing';
  if (!isDirty) return 'saved';
  if (asyncOverride === 'offline') return 'offline';
  return 'saved';
}

/**
 * Debounced auto-sync engine for cloud-backed projects.
 *
 * When `isDirty && canAutoSync`, schedules a cloud save after
 * `CLOUD_SYNC_DEBOUNCE_MS`. Tracks sync status for UI indicators.
 * Provides `flushSync` for immediate save (e.g., beforeunload).
 */
export function useAutoSync(deps: UseAutoSyncDeps): UseAutoSyncResult {
  const { isDirty, internalRef, dataVersionRef, canAutoSync, getJwt, saveToCloud } = deps;

  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Async status override: only set from async callbacks (never synchronously
  // in an effect body) to satisfy the react-hooks/set-state-in-effect rule.
  // `null` means "derive from canAutoSync/isDirty". Stale overrides are
  // handled by deriveSyncStatus priority (e.g., !isDirty overrides 'offline').
  const [asyncOverride, setAsyncOverride] = useState<'syncing' | 'offline' | null>(null);

  useEffect(() => {
    if (!canAutoSync || !isDirty) return;

    let cancelled = false;
    const attemptSync = async () => {
      if (cancelled) return;
      const jwt = getJwt();
      if (!jwt) return;
      setAsyncOverride('syncing');
      try {
        const executed = await saveToCloud();
        if (cancelled) return;
        if (!executed) {
          // Mutation lock was held — reschedule so data isn't silently dropped
          syncTimerRef.current = setTimeout(attemptSync, CLOUD_SYNC_DEBOUNCE_MS);
          return;
        }
        setAsyncOverride(null);
      } catch {
        if (!cancelled) setAsyncOverride('offline');
        // No automatic retry — the next user edit will trigger a fresh sync attempt
      }
    };
    syncTimerRef.current = setTimeout(attemptSync, CLOUD_SYNC_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      // Reset async status on cleanup to prevent stale 'offline'/'syncing'
      // from leaking when canAutoSync toggles off or project switches.
      // Scheduled as microtask to satisfy react-hooks/set-state-in-effect.
      void Promise.resolve().then(() => setAsyncOverride(null));
    };
  }, [isDirty, canAutoSync, getJwt, saveToCloud]);

  const syncStatus = deriveSyncStatus(canAutoSync, isDirty, asyncOverride);

  const flushSync = useCallback(async (stateOverride?: AppState) => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    // Derive dirty status from refs so this callback is referentially stable
    // (isDirty in the dep array caused a stale-closure duplicate PUT).
    const { cloudId, isOwner, lastSavedVersion } = internalRef.current;
    if (!cloudId || !isOwner || dataVersionRef.current === lastSavedVersion) {
      return;
    }
    const jwt = getJwt();
    if (!jwt) return;
    try {
      await saveToCloud(stateOverride);
    } catch {
      // Best-effort flush — callers (beforeunload, flush-before-evict) cannot
      // handle errors meaningfully. Auto-sync catches separately for offline status.
    }
  }, [getJwt, saveToCloud, internalRef, dataVersionRef]);

  return { syncStatus, flushSync, syncTimerRef };
}
