import { DEFAULT_PROJECT_NAME, type ProjectListEntry, type Visibility } from '../types/project';
import { listProjects } from './api-client';
import type { CloudMetadataWriteOptions, SyncResult } from '../types/cloud-sync';

interface SyncPatch {
  localId: string;
  cloudSavedAt?: string;
  visibility?: Visibility;
  serverVersion?: number;
}

export interface ServerProject {
  id: string;
  title: string | null;
  visibility: Visibility;
  updatedAt: string;
  version: number;
}

interface SyncPatchResult {
  patches: SyncPatch[];
  staleCloudIds: string[];
  /** Server projects that have no matching local entry */
  cloudOnlyProjects: ServerProject[];
}

function positiveVersion(value: number | null | undefined): number | null {
  return typeof value === 'number' && value > 0 ? value : null;
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
  projects: ReadonlyArray<ProjectListEntry>,
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
      const localVersion = positiveVersion(entry.serverVersion);
      const serverVersion = positiveVersion(serverProject.version);

      // Do not regress metadata from an older list response that arrived late.
      if (localVersion && serverVersion && serverVersion < localVersion) continue;

      const serverTime = new Date(serverProject.updatedAt).getTime();
      const localCloudTime = entry.cloudSavedAt ? new Date(entry.cloudSavedAt).getTime() : 0;
      const effectiveLocalTime = Number.isNaN(localCloudTime) ? 0 : localCloudTime;
      const serverPayloadVersionMatchesLocal = !!localVersion && !!serverVersion && serverVersion === localVersion;
      if (!Number.isNaN(serverTime)) {
        // Treat malformed local date as epoch 0 (always older than server)
        if (serverTime > effectiveLocalTime && serverPayloadVersionMatchesLocal) {
          patch.cloudSavedAt = serverProject.updatedAt;
          hasUpdate = true;
        }
      }
      if (serverProject.visibility !== entry.visibility) {
        patch.visibility = serverProject.visibility;
        hasUpdate = true;
      }
      if (serverVersion && serverVersion !== localVersion) {
        const cachedPayloadMatchesListedServer = !Number.isNaN(serverTime) &&
          !Number.isNaN(localCloudTime) &&
          localCloudTime === serverTime;
        if (cachedPayloadMatchesListedServer) {
          patch.serverVersion = serverVersion;
          hasUpdate = true;
        }
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

interface PlaceholderData {
  title: string;
  cloudId: string;
  visibility: Visibility;
  cloudSavedAt: string;
  serverVersion: number;
}

interface SyncCallbacks {
  updateCloudMetadata: (
    localId: string,
    updates: Partial<{ cloudSavedAt: string; visibility: Visibility; serverVersion: number }>,
    options?: CloudMetadataWriteOptions,
  ) => void;
  createPlaceholder: (data: PlaceholderData) => void;
}

/**
 * Fetch the authenticated user's cloud projects and reconcile with local state.
 *
 * Returns metadata patches applied, stale cloud IDs (server-deleted), and
 * count of cloud-only projects that were created as local placeholders.
 *
 * Side effects are delegated to callbacks so this function remains testable
 * without React context dependencies.
 */
export async function syncCloudProjectsFromServer(
  jwt: string,
  projects: ReadonlyArray<ProjectListEntry>,
  callbacks: SyncCallbacks,
): Promise<SyncResult> {
  const response = await listProjects(jwt);

  const { patches, staleCloudIds, cloudOnlyProjects } = computeSyncPatches(
    projects,
    response.projects,
  );

  for (const { localId, ...updates } of patches) {
    callbacks.updateCloudMetadata(localId, updates, { preserveLocalSavedAt: true });
  }

  for (const sp of cloudOnlyProjects) {
    callbacks.createPlaceholder({
      title: sp.title ?? DEFAULT_PROJECT_NAME,
      cloudId: sp.id,
      visibility: sp.visibility,
      cloudSavedAt: sp.updatedAt,
      serverVersion: sp.version,
    });
  }

  return { updatedCount: patches.length, staleCloudIds, placeholdersCreated: cloudOnlyProjects.length };
}
