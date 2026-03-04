import type { ProjectListEntry, Visibility } from '../types/project';

export interface SyncPatch {
  localId: string;
  cloudSavedAt?: string;
  visibility?: Visibility;
}

export interface ServerProject {
  id: string;
  title: string | null;
  visibility: Visibility;
  updatedAt: string;
}

export interface SyncPatchResult {
  patches: SyncPatch[];
  staleCloudIds: string[];
  /** Server projects that have no matching local entry */
  cloudOnlyProjects: ServerProject[];
}

/**
 * Compare local manifest entries against server-side projects and produce
 * a set of patches (metadata updates), stale cloud IDs (server-deleted),
 * and cloud-only projects (no local counterpart).
 *
 * Only processes entries with `storage === 'cloud'` — shared/non-owned
 * projects loaded via link have `storage === 'local'` and are skipped.
 */
export function computeSyncPatches(
  projects: ProjectListEntry[],
  serverProjects: ReadonlyArray<ServerProject>,
): SyncPatchResult {
  const serverMap = new Map(serverProjects.map(p => [p.id, p]));
  const patches: SyncPatch[] = [];
  const staleCloudIds: string[] = [];
  const localCloudIds = new Set(projects.filter(p => p.cloudId).map(p => p.cloudId!));

  for (const entry of projects) {
    // Only sync metadata for owned cloud projects (storage === 'cloud').
    // Shared/non-owned projects loaded via link have storage === 'local'
    // and should not have their metadata overwritten by sync.
    if (!entry.cloudId || entry.storage !== 'cloud') continue;

    const serverProject = serverMap.get(entry.cloudId);
    if (serverProject) {
      const patch: SyncPatch = { localId: entry.localId };
      let hasUpdate = false;

      const serverTime = new Date(serverProject.updatedAt).getTime();
      const localCloudTime = entry.cloudSavedAt ? new Date(entry.cloudSavedAt).getTime() : 0;
      if (serverTime > localCloudTime) {
        patch.cloudSavedAt = serverProject.updatedAt;
        hasUpdate = true;
      }
      if (serverProject.visibility !== entry.visibility) {
        patch.visibility = serverProject.visibility;
        hasUpdate = true;
      }
      if (hasUpdate) patches.push(patch);
    } else {
      staleCloudIds.push(entry.cloudId);
    }
  }

  // Find server projects with no local counterpart
  const cloudOnlyProjects = serverProjects.filter(sp => !localCloudIds.has(sp.id));

  return { patches, staleCloudIds, cloudOnlyProjects };
}
