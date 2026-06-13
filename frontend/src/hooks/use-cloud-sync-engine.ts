import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { CLOUD_SYNC_DEBOUNCE_MS } from '../constants';
import { ApiError } from '../utils/api-client';
import { isDirty as computeIsDirty, type CloudSyncAction } from '../utils/cloud-sync-reducer';
import type { InternalCloudSyncState, SaveOutcome } from '../types/cloud-sync';

const MAX_AUTO_SYNC_RETRIES = 4;

/**
 * Cloud auto-sync status for the active project.
 * - `saved`: cloud is up to date with local state
 * - `syncing`: a cloud save is in progress
 * - `offline`: last sync attempt failed (network/server error); also set when
 *   auto-sync gave up after repeated lock contention, or when the server write
 *   succeeded but the local write failed (local-persist-failed)
 * - `rejected`: the server deterministically refused the last save
 *   (400/413/422 — validation or payload size); retrying cannot fix it, only
 *   editing the flagged data can (BR-7)
 * - `local-only`: project is not cloud-backed (no auto-sync)
 */
export type SyncStatus = 'saved' | 'syncing' | 'offline' | 'rejected' | 'local-only';

/** The async overlay values the engine dispatches via SET_ASYNC_TRANSIENT. */
type AsyncOverride = 'syncing' | 'offline' | 'rejected' | null;

interface DataDeps {
  registers: unknown;
  registerValues: unknown;
  project?: unknown;
  addressUnitBits?: unknown;
}

export interface UseCloudSyncEngineDeps {
  dataDeps: DataDeps;
  internal: InternalCloudSyncState;
  dispatch: Dispatch<CloudSyncAction>;
  canAutoSync: boolean;
  getJwt: () => string | null;
  saveToCloud: () => Promise<SaveOutcome>;
}

interface UseCloudSyncEngineResult {
  isDirty: boolean;
  syncStatus: SyncStatus;
  flushCloudSync: () => Promise<void>;
  syncTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  dataVersionRef: MutableRefObject<number>;
  mutationLockRef: MutableRefObject<boolean>;
}

/**
 * Derive sync status from inputs and an async override.
 *
 * Priority: `!canAutoSync` -> local-only; `syncing` always shows (active save);
 * `!isDirty` -> saved (overrides stale 'offline'/'rejected'); `isDirty +
 * rejected` -> rejected; `isDirty + offline` -> offline.
 *
 * Note (BP-4): During the debounce window (isDirty but timer hasn't fired),
 * this returns 'saved' rather than a 'pending' status. This is intentional:
 * showing "pending" for every keystroke during the 3s debounce would create
 * visual noise. The brief inaccuracy is acceptable UX.
 */
export function deriveSyncStatus(canAutoSync: boolean, isDirty: boolean, asyncOverride: AsyncOverride): SyncStatus {
  if (!canAutoSync) return 'local-only';
  if (asyncOverride === 'syncing') return 'syncing';
  if (!isDirty) return 'saved';
  if (asyncOverride === 'rejected') return 'rejected';
  if (asyncOverride === 'offline') return 'offline';
  return 'saved';
}

/**
 * Merged cloud sync engine combining dirty tracking and auto-sync.
 *
 * Dirty tracking: Generation-counter pattern that increments a version counter
 * whenever app-state data deps change. Compares the current version against
 * the last-saved version to derive `isDirty`. Only triggers a re-render when
 * the dirty status actually flips (false->true or true->false).
 *
 * Auto-sync: When `isDirty && canAutoSync`, schedules a cloud save after
 * `CLOUD_SYNC_DEBOUNCE_MS`. Tracks sync status for UI indicators.
 * Provides `flushCloudSync` for immediate save (e.g., beforeunload).
 *
 * Key benefit: `isDirty` is computed internally and directly consumed by the
 * auto-sync effect, eliminating a render cycle between the two.
 */
export function useCloudSyncEngine(deps: UseCloudSyncEngineDeps): UseCloudSyncEngineResult {
  const { dataDeps, internal, dispatch, canAutoSync, getJwt, saveToCloud } = deps;

  // ── Dirty tracking refs and state ──────────────────────────────────
  const mutationLockRef = useRef(false);
  const dataVersionRef = useRef(0);
  const [isDirty, setIsDirty] = useState(false);
  // Sentinel: use Symbol() so the first effect run always detects a data change
  const prevDataDepsRef = useRef<DataDeps>({
    registers: Symbol(), registerValues: Symbol(), project: Symbol(), addressUnitBits: Symbol(),
  } as unknown as DataDeps);

  // ── Auto-sync refs and state ───────────────────────────────────────
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Async status override (S9): lives on reducer state as `internal.asyncTransient`,
  // dispatched via SET_ASYNC_TRANSIENT. Only set from async callbacks (never
  // synchronously in an effect body) to satisfy the react-hooks/set-state-in-effect
  // rule. `null` means "derive from canAutoSync/isDirty". Stale overrides are
  // handled by deriveSyncStatus priority (e.g., !isDirty overrides 'offline').
  const setAsyncOverride = useCallback(
    (value: AsyncOverride) => {
      dispatch({ type: 'SET_ASYNC_TRANSIENT', value });
    },
    [dispatch],
  );

  // ── Dirty tracking effect ──────────────────────────────────────────
  // The setState-in-effect pattern is intentional here: we must compare the
  // ref-based version counter (which can't trigger renders) against the
  // last-saved version (from state) and only re-render when dirty status
  // actually changes. This avoids re-rendering on every keystroke.
  useEffect(() => {
    // Only bump version when actual data deps changed (not cloudId/baseline)
    const prev = prevDataDepsRef.current;
    const dataChanged = prev.registers !== dataDeps.registers
      || prev.registerValues !== dataDeps.registerValues
      || prev.project !== dataDeps.project
      || prev.addressUnitBits !== dataDeps.addressUnitBits;
    prevDataDepsRef.current = dataDeps;

    if (dataChanged) {
      dataVersionRef.current++;
    }

    // Baseline-capture handshake (S8/S14a): a writer adopted a new cloud baseline
    // via REQUEST_BASELINE, which set `baseline:{untracked}` as the awaiting
    // marker. Capture the POST-increment generation into a `clean` baseline via
    // CAPTURE_BASELINE (dispatched directly). The `cloudId !== null` guard separates an awaiting CLOUD
    // project from a fresh untracked LOCAL one. Must run after the dataVersionRef
    // bump above so the captured tick matches the legacy needsVersionSyncRef
    // behavior exactly.
    if (internal.cloudId !== null && internal.baseline.kind === 'untracked') {
      const capturedVersion = dataVersionRef.current;
      dispatch({ type: 'CAPTURE_BASELINE', version: capturedVersion });
      return;
    }

    setIsDirty(computeIsDirty(internal.baseline, internal.cloudId, dataVersionRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataDeps is accessed only via its individual properties (already in the dep array); the object reference is stored for next-render comparison only
  }, [dataDeps.registers, dataDeps.registerValues, dataDeps.project, dataDeps.addressUnitBits, internal.cloudId, internal.baseline, dispatch]);

  // ── Auto-sync effect ───────────────────────────────────────────────
  useEffect(() => {
    if (!canAutoSync || !isDirty) return;

    let cancelled = false;
    let retryCount = 0;
    const attemptSync = async () => {
      if (cancelled) return;
      const jwt = getJwt();
      if (!jwt) return;
      setAsyncOverride('syncing');
      try {
        const outcome = await saveToCloud();
        if (cancelled) return;
        switch (outcome) {
          case 'lock-held':
            if (retryCount < MAX_AUTO_SYNC_RETRIES) {
              // Exponential backoff so a wedged lock can't sustain a 0.33Hz PUT loop.
              const delay = CLOUD_SYNC_DEBOUNCE_MS * 2 ** retryCount;
              retryCount++;
              syncTimerRef.current = setTimeout(attemptSync, delay);
            } else {
              // Gave up. Recovers via manual save, project switch, or auth change — further edits alone do not re-arm auto-sync.
              setAsyncOverride('offline');
            }
            return;
          case 'local-persist-failed':
            // Server write succeeded; the local write failed. Do NOT retry (a retry
            // would re-PUT and could manufacture a 409). Surface offline.
            setAsyncOverride('offline');
            return;
          case 'saved':
          case 'created':
          case 'noop':
          case 'login-required':
          case 'not-found':
          case 'conflict':
          case 'conflict-pending':
            // 'conflict-pending' (BR-1): an open conflict refused the save. Do
            // NOT retry — only the banner's explicit force may save.
            setAsyncOverride(null);
            return;
          default: {
            void ((_e: never) => _e)(outcome);
            setAsyncOverride(null);
          }
        }
      } catch (err) {
        if (cancelled) return;
        // A deterministic server rejection (validation 400, payload-too-large
        // 413, semantic 422) will fail identically on every retry — surface
        // 'rejected' so the steady-state indicator points at the data, not the
        // network. Everything else (network failure, 5xx) stays 'offline'.
        const isRejected = err instanceof ApiError
          && (err.status === 400 || err.status === 413 || err.status === 422);
        setAsyncOverride(isRejected ? 'rejected' : 'offline');
        // Recovers via manual save, project switch, or auth change — further edits alone do not re-arm auto-sync.
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
  }, [isDirty, canAutoSync, getJwt, saveToCloud, setAsyncOverride]);

  // ── Derived sync status ────────────────────────────────────────────
  const syncStatus = deriveSyncStatus(canAutoSync, isDirty, internal.asyncTransient ?? null);

  // ── Flush callback ─────────────────────────────────────────────────
  // We need a ref for internal to avoid stale closures in flushCloudSync.
  // This is render-time sync (same pattern as internalRef in CloudSyncProvider).
  const internalRef = useRef(internal);
  internalRef.current = internal;

  const flushCloudSync = useCallback(async () => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    // Derive dirty status from refs so this callback is referentially stable
    // (isDirty in the dep array caused a stale-closure duplicate PUT).
    const { cloudId, isOwner, baseline, conflict } = internalRef.current;
    // Conflict gate (BR-1, mirrors canAutoSync): during an open conflict the
    // advanced serverVersion would let the PUT succeed and silently overwrite
    // the other device. This in-memory guard is load-bearing — when the dirty-409
    // local persist failed (quota), the manifest may lack cloudConflictVersion.
    if (conflict !== null) return;
    if (!isOwner || !computeIsDirty(baseline, cloudId, dataVersionRef.current)) {
      return;
    }
    const jwt = getJwt();
    if (!jwt) return;
    try {
      await saveToCloud();
    } catch {
      // Best-effort flush -- callers (beforeunload) cannot handle errors
      // meaningfully. Auto-sync catches separately for offline status.
    }
  }, [getJwt, saveToCloud]);

  return { isDirty, syncStatus, flushCloudSync, syncTimerRef, dataVersionRef, mutationLockRef };
}
