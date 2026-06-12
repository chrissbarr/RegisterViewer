import type { Dispatch, MutableRefObject } from 'react';
import type { Visibility } from './project';
import type { CloudSyncAction } from '../utils/cloud-sync-reducer';

/**
 * The save baseline a cloud project's data generation is compared against to
 * derive dirtiness (S14a). Replaces the three overloaded meanings of the former
 * `lastSavedVersion: number` sentinel AND folds in the S8 "awaiting capture"
 * marker (the former `awaitingBaselineCapture` flag):
 * - `untracked` — was `lastSavedVersion === -1`. The initial/local state, AND
 *   the one-shot "awaiting baseline capture" marker set by REQUEST_BASELINE
 *   after a writer adopts a new cloud baseline. The engine snapshots the
 *   post-increment generation into a `clean` baseline on its next effect tick
 *   (CAPTURE_BASELINE) when `cloudId !== null` — the `cloudId` guard separates
 *   an awaiting CLOUD project from a fresh untracked LOCAL one. `isDirty=false`.
 * - `dirty` — was `Number.MAX_SAFE_INTEGER`. Always dirty until the first save
 *   (stored-unsynced cloud payload).
 * - `clean` — was a real `dataVersion` generation. Dirty iff the current
 *   generation differs from `version`.
 */
export type Baseline =
  | { kind: 'untracked' }
  | { kind: 'dirty' }
  | { kind: 'clean'; version: number };

/** Shared with useActiveProjectCloudOps, useProjectCloudOps, and other cloud hooks. */
export interface InternalCloudSyncState {
  cloudId: string | null;
  isOwner: boolean;
  storage: 'local' | 'cloud';
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastCloudSavedAt: string | null;
  /**
   * Save baseline for dirtiness (S14a). Replaces the former
   * `lastSavedVersion: number` sentinel and the separate
   * `awaitingBaselineCapture` flag — `{kind:'untracked'}` doubles as the
   * "awaiting baseline capture" marker (gated by `cloudId !== null` in the
   * engine). See {@link Baseline}.
   */
  baseline: Baseline;
  visibility: Visibility;
  serverVersion: number; // last known server version (0 = unknown)
  conflict: { serverVersion: number } | null; // non-null triggers conflict UX
  /**
   * Async sync/offline overlay (S9). Set ONLY from the auto-sync engine's async
   * callbacks (never synchronously in an effect body) and microtask-cleared on
   * effect cleanup. Distinct from `status` because it overlays the op-status with
   * a different lifecycle and is read as `deriveSyncStatus`'s third (transient)
   * input. Optional/transient so white-box `makeInternal({...})` constructions
   * stay valid without it (defaults to undefined === no overlay). Replaces the
   * former engine-local `asyncOverride` useState.
   */
  asyncTransient?: 'syncing' | 'offline' | null;
}

export interface CloudInit {
  projectId: string;
  isOwner: boolean;
  storage?: 'local' | 'cloud';
  serverVersion?: number | null;
  cloudSavedAt?: string | null;
  visibility?: Visibility;
  cloudConflictVersion?: number | null;
  hasUnsyncedChanges?: boolean;
}

/**
 * Default cloud sync state. Object.freeze prevents accidental mutation.
 *
 * React's useReducer uses Object.is comparison — the LIFECYCLE_RESET action
 * returns this frozen object by reference, so a reset to the already-initial
 * state bails out of re-render (same reference). This is intentional and
 * desirable for the sign-out reset path.
 */
export const initialInternalState: InternalCloudSyncState = Object.freeze({
  cloudId: null,
  isOwner: false,
  storage: 'local',
  status: 'idle',
  error: null,
  shareUrl: null,
  lastCloudSavedAt: null,
  baseline: { kind: 'untracked' } as Baseline,
  visibility: 'private',
  serverVersion: 0,
  conflict: null,
});

/**
 * Shared refs and the reducer dispatch passed to all cloud sync hooks (AR-1).
 *
 * Groups the dependencies that every cloud sync hook needs, reducing per-hook
 * parameter counts and centralising changes when the internal state shape
 * evolves. S14b replaced the former `setInternal` shim with the reducer
 * `dispatch`: every lifecycle write is now a direct `dispatch(action)`. Sites
 * that need same-commit `internalRef.current` visibility compute `next`
 * explicitly and write the ref before dispatching (DESIGN §5).
 */
export interface CloudSyncCore {
  internalRef: MutableRefObject<InternalCloudSyncState>;
  activeLocalIdRef: MutableRefObject<string | null>;
  dispatch: Dispatch<CloudSyncAction>;
}

/** Partial cloud metadata payload accepted by `updateCloudMetadata`. */
export interface CloudMetadataUpdate {
  cloudId?: string | null;
  cloudSavedAt?: string | null;
  visibility?: Visibility;
  storage?: 'local' | 'cloud';
  serverVersion?: number | null;
  cloudConflictVersion?: number | null;
  hasUnsyncedChanges?: boolean;
}

export interface CloudMetadataWriteOptions {
  preserveLocalSavedAt?: boolean;
  protectedLocalIds?: readonly (string | null | undefined)[];
}

/**
 * Outcome of an active-project cloud save. Replaces the ambiguous boolean so the
 * auto-sync engine can reschedule ONLY on lock contention and never re-PUT a
 * stale version after a local-persist failure.
 * - `saved`/`created`/`noop` — terminal success (or nothing to do).
 * - `login-required` — deferred to the login dialog.
 * - `lock-held` — mutation lock busy; safe to retry.
 * - `not-found`/`conflict` — server-side state handled via dispatch (no retry).
 * - `local-persist-failed` — server write succeeded but the local write failed.
 * - `conflict-pending` — open conflict; only the banner's explicit force may save.
 */
export type SaveOutcome =
  | 'saved' | 'created' | 'noop'
  | 'login-required' | 'lock-held'
  | 'not-found' | 'conflict' | 'local-persist-failed'
  | 'conflict-pending';

/** True when a save outcome means the data is safely on the server (or nothing to do). */
export function isSaveSuccess(outcome: SaveOutcome): boolean {
  return outcome === 'saved' || outcome === 'created' || outcome === 'noop';
}

export interface SyncResult {
  updatedCount: number;
  staleCloudIds: string[];
  /** Stale cloud IDs whose local metadata/placeholders were reconciled */
  staleReconciledCloudIds: string[];
  /** Stale cloud IDs that were detected but could not be reconciled */
  staleReconcileFailedCloudIds: string[];
  /** Number of cloud-only projects that were added as local placeholders */
  placeholdersCreated: number;
}
