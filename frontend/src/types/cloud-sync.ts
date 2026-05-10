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
}

export interface SyncResult {
  updatedCount: number;
  staleCloudIds: string[];
  /** Number of cloud-only projects that were added as local placeholders */
  placeholdersCreated: number;
}
