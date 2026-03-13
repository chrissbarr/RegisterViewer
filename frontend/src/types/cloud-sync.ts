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
}

export const initialInternalState: InternalCloudSyncState = {
  cloudId: null,
  isOwner: false,
  storage: 'local',
  status: 'idle',
  error: null,
  shareUrl: null,
  lastCloudSavedAt: null,
  lastSavedVersion: -1,
  visibility: 'private',
};

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

/** Subset of InternalCloudSyncState needed by the auto-sync engine. */
export type AutoSyncInternalSlice = Pick<InternalCloudSyncState, 'cloudId' | 'isOwner' | 'storage' | 'lastSavedVersion' | 'error'>;

/** Subset of InternalCloudSyncState needed by the dirty-tracking hook. */
export type DirtyTrackingInternalSlice = Pick<InternalCloudSyncState, 'cloudId' | 'lastSavedVersion'>;

/** Partial cloud metadata payload accepted by `updateCloudMetadata`. */
export interface CloudMetadataUpdate {
  cloudId?: string | null;
  cloudSavedAt?: string | null;
  visibility?: Visibility;
  storage?: 'local' | 'cloud';
}

export interface SyncResult {
  updatedCount: number;
  staleCloudIds: string[];
  /** Number of cloud-only projects that were added as local placeholders */
  placeholdersCreated: number;
}
