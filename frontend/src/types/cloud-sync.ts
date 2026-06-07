import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { Visibility } from './project';

/** Shared with useActiveProjectCloudOps, useProjectCloudOps, and other cloud hooks. */
export interface InternalCloudSyncState {
  cloudId: string | null;
  isOwner: boolean;
  storage: 'local' | 'cloud';
  status: 'idle' | 'saving' | 'loading' | 'deleting';
  error: string | null;
  shareUrl: string | null;
  lastCloudSavedAt: string | null;
  lastSavedVersion: number;
  visibility: Visibility;
  serverVersion: number; // last known server version (0 = unknown)
  conflict: { serverVersion: number } | null; // non-null triggers conflict UX
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
 * React's useState setter uses Object.is comparison — passing this frozen
 * object to setInternal(initialInternalState) will bail out of re-render if
 * the state is already the initial state (same reference). This is intentional
 * and desirable for the sign-out reset path.
 */
export const initialInternalState: InternalCloudSyncState = Object.freeze({
  cloudId: null,
  isOwner: false,
  storage: 'local',
  status: 'idle',
  error: null,
  shareUrl: null,
  lastCloudSavedAt: null,
  lastSavedVersion: -1,
  visibility: 'private',
  serverVersion: 0,
  conflict: null,
});

/**
 * Shared refs and state setters passed to all cloud sync hooks (AR-1).
 *
 * Groups the four dependencies that every cloud sync hook needs,
 * reducing per-hook parameter counts and centralising changes when
 * the internal state shape evolves.
 */
export interface CloudSyncCore {
  internalRef: MutableRefObject<InternalCloudSyncState>;
  activeLocalIdRef: MutableRefObject<string | null>;
  setInternal: Dispatch<SetStateAction<InternalCloudSyncState>>;
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
 * - `not-found`/`conflict` — server-side state handled via setInternal (no retry).
 * - `local-persist-failed` — server write succeeded but the local write failed.
 */
export type SaveOutcome =
  | 'saved' | 'created' | 'noop'
  | 'login-required' | 'lock-held'
  | 'not-found' | 'conflict' | 'local-persist-failed';

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
