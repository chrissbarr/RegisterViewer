import {
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  patchProjectVisibility as apiPatchVisibility,
  deleteProject as apiDeleteProject,
  ApiError,
  type AuthCredentials,
} from './api-client';
import {
  getOwnerTokenForProject,
  getOrCreateOwnerToken,
  hashOwnerToken,
} from './owner-token';
import type { Visibility } from '../types/project';

interface SaveCreatedResult {
  kind: 'created';
  cloudId: string;
  timestamp: string;
  ownerToken: string;
}

interface SaveUpdatedResult {
  kind: 'updated';
  cloudId: string;
  timestamp: string;
}

interface SaveNotFoundResult {
  kind: 'not-found';
}

type SaveResult = SaveCreatedResult | SaveUpdatedResult | SaveNotFoundResult;

/**
 * Resolve auth credentials for an existing cloud project.
 * Throws if neither an owner token nor JWT is available.
 */
async function resolveProjectAuth(
  cloudId: string,
  jwt?: string | null,
): Promise<AuthCredentials> {
  const ownerToken = getOwnerTokenForProject(cloudId);
  const tokenHash = ownerToken ? await hashOwnerToken(ownerToken) : '';
  if (!ownerToken && !jwt) {
    throw new Error('No auth credentials available for project.');
  }
  return { tokenHash, jwt: jwt ?? undefined };
}

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
  jwt?: string | null,
): Promise<SaveResult> {
  if (existingCloudId) {
    const auth = await resolveProjectAuth(existingCloudId, jwt);
    try {
      const result = await apiUpdateProject(existingCloudId, jsonPayload, auth);
      return { kind: 'updated', cloudId: existingCloudId, timestamp: result.updatedAt };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        return { kind: 'not-found' };
      }
      throw err;
    }
  }

  const ownerToken = getOrCreateOwnerToken();
  const tokenHash = await hashOwnerToken(ownerToken);
  const auth: AuthCredentials = { tokenHash, jwt: jwt ?? undefined, ownerToken };
  const result = await apiCreateProject(jsonPayload, auth);
  return { kind: 'created', cloudId: result.id, timestamp: result.createdAt, ownerToken };
}

/**
 * Delete a cloud project by its cloudId.
 * @throws If owner token is missing or the API call fails.
 */
export async function deleteProjectFromCloudImpl(cloudId: string, jwt?: string | null): Promise<void> {
  const auth = await resolveProjectAuth(cloudId, jwt);
  await apiDeleteProject(cloudId, auth);
}

/**
 * Patch the visibility of a cloud project using the PATCH endpoint.
 * @throws If owner token is missing or the API call fails.
 */
export async function patchVisibilityImpl(
  cloudId: string,
  visibility: Visibility,
  jwt?: string | null,
): Promise<void> {
  const auth = await resolveProjectAuth(cloudId, jwt);
  await apiPatchVisibility(cloudId, visibility, auth);
}
