import {
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  patchProjectVisibility as apiPatchVisibility,
  deleteProject as apiDeleteProject,
  ApiError,
} from './api-client';
import type { Visibility } from '../types/project';

export type SaveCreatedResult = {
  kind: 'created';
  cloudId: string;
  timestamp: string;
  version: number;
};

export type SaveUpdatedResult = {
  kind: 'updated';
  cloudId: string;
  timestamp: string;
  version: number;
};

export type SaveNotFoundResult = {
  kind: 'not-found';
};

export type SaveConflictResult = {
  kind: 'conflict';
  serverVersion: number;
};

export type SaveResult = SaveCreatedResult | SaveUpdatedResult | SaveNotFoundResult | SaveConflictResult;

/**
 * Save a project to the cloud. Creates or updates depending on whether
 * existingCloudId is provided.
 *
 * Returns a discriminated union:
 * - `created` — new cloud project created
 * - `updated` — existing cloud project updated
 * - `not-found` — 404 on update (project deleted server-side)
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
        if (err.status === 409) {
          const currentVersion = typeof err.errorBody?.currentVersion === 'number'
            ? err.errorBody.currentVersion
            : 0;
          return { kind: 'conflict', serverVersion: currentVersion };
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
    version: 1,
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
 * @throws If the API call fails.
 */
export async function patchVisibilityImpl(
  cloudId: string,
  visibility: Visibility,
  jwt: string,
): Promise<void> {
  await apiPatchVisibility(cloudId, visibility, jwt);
}
