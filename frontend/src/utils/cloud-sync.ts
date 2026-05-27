import { DEFAULT_PROJECT_NAME, type ProjectListEntry, type Visibility } from '../types/project';
import { listProjects } from './api-client';
import type { CloudMetadataWriteOptions, SyncResult } from '../types/cloud-sync';
import { isOwnedCloudEntry } from './project-identity';

interface SyncPatch {
  localId: string;
  cloudSavedAt?: string;
  visibility?: Visibility;
  serverVersion?: number;
}

export interface StaleCloudProject {
  localId: string;
  cloudId: string;
  cloudSavedAt: string | null;
  serverVersion: number | null;
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
  staleCloudProjects: StaleCloudProject[];
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
  const staleCloudProjects: StaleCloudProject[] = [];
  const localCloudIds = new Set(projects.filter(isOwnedCloudEntry).map(p => p.cloudId));

  for (const entry of projects) {
    // Only sync metadata for owned cloud projects (storage === 'cloud').
    // Shared/non-owned projects loaded via link have storage === 'local'
    // and should not have their metadata overwritten by sync.
    if (!isOwnedCloudEntry(entry)) continue;

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
      staleCloudProjects.push({
        localId: entry.localId,
        cloudId: entry.cloudId,
        cloudSavedAt: entry.cloudSavedAt ?? null,
        serverVersion: entry.serverVersion ?? null,
      });
    }
  }

  // Find server projects with no local counterpart
  const cloudOnlyProjects = serverProjects.filter(sp => !localCloudIds.has(sp.id));

  return { patches, staleCloudIds, staleCloudProjects, cloudOnlyProjects };
}

interface PlaceholderData {
  title: string;
  cloudId: string;
  visibility: Visibility;
  cloudSavedAt: string;
  serverVersion: number;
}

interface SyncWriteOptions {
  protectedLocalIds: readonly string[];
}

interface SyncCallbacks {
  updateCloudMetadata: (
    localId: string,
    updates: Partial<{ cloudSavedAt: string; visibility: Visibility; serverVersion: number }>,
    options?: CloudMetadataWriteOptions,
  ) => void;
  createPlaceholder: (data: PlaceholderData, options?: SyncWriteOptions) => boolean | void;
  reconcileStaleCloudProject: (
    project: StaleCloudProject,
    options: SyncWriteOptions,
  ) => boolean | Promise<boolean>;
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

  const { patches, staleCloudIds, staleCloudProjects, cloudOnlyProjects } = computeSyncPatches(
    projects,
    response.projects,
  );

  const staleWriteOptions: SyncWriteOptions | undefined = staleCloudProjects.length > 0
    ? { protectedLocalIds: staleCloudProjects.map(project => project.localId) }
    : undefined;

  const staleReconciledCloudIds: string[] = [];
  const staleReconcileFailedCloudIds: string[] = [];
  if (staleWriteOptions) {
    for (const staleProject of staleCloudProjects) {
      let reconciled = false;
      try {
        reconciled = await callbacks.reconcileStaleCloudProject(staleProject, staleWriteOptions);
      } catch {
        reconciled = false;
      }
      if (reconciled) {
        staleReconciledCloudIds.push(staleProject.cloudId);
      } else {
        staleReconcileFailedCloudIds.push(staleProject.cloudId);
      }
    }
  }

  for (const { localId, ...updates } of patches) {
    callbacks.updateCloudMetadata(localId, updates, {
      preserveLocalSavedAt: true,
      ...(staleWriteOptions ? { protectedLocalIds: staleWriteOptions.protectedLocalIds } : {}),
    });
  }

  let placeholdersCreated = 0;
  for (const sp of cloudOnlyProjects) {
    const placeholderData = {
      title: sp.title ?? DEFAULT_PROJECT_NAME,
      cloudId: sp.id,
      visibility: sp.visibility,
      cloudSavedAt: sp.updatedAt,
      serverVersion: sp.version,
    };
    const created = staleWriteOptions
      ? callbacks.createPlaceholder(placeholderData, staleWriteOptions)
      : callbacks.createPlaceholder(placeholderData);
    if (created !== false) placeholdersCreated++;
  }

  return {
    updatedCount: patches.length,
    staleCloudIds,
    staleReconciledCloudIds,
    staleReconcileFailedCloudIds,
    placeholdersCreated,
  };
}
