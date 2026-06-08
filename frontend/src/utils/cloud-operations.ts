import {
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  patchProjectVisibility as apiPatchVisibility,
  deleteProject as apiDeleteProject,
  ApiError,
  isConflictError,
} from './api-client';
import type { Visibility } from '../types/project';

type SaveCreatedResult = {
  kind: 'created';
  cloudId: string;
  timestamp: string;
  version: number;
};

type SaveUpdatedResult = {
  kind: 'updated';
  cloudId: string;
  timestamp: string;
  version: number;
};

type SaveNotFoundResult = {
  kind: 'not-found';
};

export type SaveConflictResult = {
  kind: 'conflict';
  serverVersion: number;
};

type SaveResult = SaveCreatedResult | SaveUpdatedResult | SaveNotFoundResult | SaveConflictResult;

/**
 * Save project data to the cloud (create or update).
 *
 * Returns a discriminated union:
 * - `created` — new cloud project created
 * - `updated` — existing cloud project updated
 * - `not-found` — 404 on update (project deleted server-side)
 * - `conflict` — 409 on update (version mismatch)
 *
 * @param serverVersion - Last known server version. Defaults to 1 when omitted
 *   (first save for a project that predates version tracking). Callers should
 *   pass `undefined` explicitly when the version is unknown (serverVersion: 0).
 */
export async function saveProjectToCloudImpl(
  jsonPayload: unknown,
  existingCloudId: string | null,
  jwt: string,
  serverVersion?: number,
): Promise<SaveResult> {
  if (existingCloudId) {
    try {
      const result = await apiUpdateProject(
        existingCloudId,
        jsonPayload,
        jwt,
        // Default to version 1 for projects created before version tracking existed.
        serverVersion ?? 1,
      );
      return {
        kind: 'updated',
        cloudId: existingCloudId,
        timestamp: result.updatedAt,
        version: result.version,
      };
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 404) {
          return { kind: 'not-found' };
        }
        if (isConflictError(err)) {
          return { kind: 'conflict', serverVersion: err.errorBody.currentVersion };
        }
      }
      throw err;
    }
  }

  const result = await apiCreateProject(jsonPayload, jwt);
  return {
    kind: 'created',
    cloudId: result.id,
    timestamp: result.createdAt,
    version: result.version,
  };
}

/**
 * Delete a cloud project by its cloudId.
 * @throws If the API call fails.
 */
export async function deleteProjectFromCloudImpl(cloudId: string, jwt: string): Promise<void> {
  await apiDeleteProject(cloudId, jwt);
}

/**
 * Patch the visibility of a cloud project using the PATCH endpoint.
 *
 * Returns the server `updatedAt` from the PATCH response so callers can keep
 * local `cloudSavedAt` in sync with the server's `updated_at` immediately. Note
 * a visibility PATCH advances `updated_at` but does NOT bump `version` — the
 * timestamp is informational, not payload identity.
 *
 * @throws If the API call fails.
 */
export async function patchVisibilityImpl(
  cloudId: string,
  visibility: Visibility,
  jwt: string,
): Promise<string> {
  const result = await apiPatchVisibility(cloudId, visibility, jwt);
  return result.updatedAt;
}
