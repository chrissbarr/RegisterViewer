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

export interface SyncResult {
  updatedCount: number;
  staleCloudIds: string[];
  /** Number of cloud-only projects that were added as local placeholders */
  placeholdersCreated: number;
}
