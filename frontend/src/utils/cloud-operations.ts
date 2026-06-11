import {
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  getProject as apiGetProject,
  getProjectMeta as apiGetProjectMeta,
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
 * @param serverVersion - Last known server version. When `undefined` (the
 *   version is unknown — e.g. `serverVersion: 0` not yet fetched), the current
 *   server version is fetched via the lightweight /meta probe first and that
 *   value is used for the PUT. When a known number is passed, the PUT uses it
 *   directly with no extra round trip.
 */
export async function saveProjectToCloudImpl(
  jsonPayload: unknown,
  existingCloudId: string | null,
  jwt: string,
  serverVersion?: number,
): Promise<SaveResult> {
  if (existingCloudId) {
    try {
      // Unknown version: probe the current server version via /meta first,
      // then PUT with it. A known version PUTs directly — no extra round-trip.
      let putVersion = serverVersion;
      if (putVersion === undefined) {
        try {
          const currentMeta = await apiGetProjectMeta(existingCloudId, jwt);
          putVersion = currentMeta.version;
        } catch (err) {
          // PERMANENT old-API/genuine-404 funnel: an API deployed without the
          // /meta endpoint 404s the probe. Fall back once to the full GET; a
          // genuinely deleted project then 404s again and surfaces through the
          // outer catch as `not-found`, exactly as before.
          if (!(err instanceof ApiError && err.status === 404)) throw err;
          const current = await apiGetProject(existingCloudId, jwt);
          putVersion = current.version;
        }
      }
      const result = await apiUpdateProject(existingCloudId, jsonPayload, jwt, putVersion);
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
