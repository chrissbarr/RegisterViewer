import {
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  patchProjectVisibility as apiPatchVisibility,
  deleteProject as apiDeleteProject,
  ApiError,
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
    const ownerToken = getOwnerTokenForProject(existingCloudId);
    const tokenHash = ownerToken ? await hashOwnerToken(ownerToken) : '';
    if (!ownerToken && !jwt) {
      throw new Error('Owner token not found for this project.');
    }
    try {
      const result = await apiUpdateProject(existingCloudId, jsonPayload, tokenHash, undefined, jwt ?? undefined);
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
  const result = await apiCreateProject(jsonPayload, tokenHash, undefined, jwt ?? undefined);
  return { kind: 'created', cloudId: result.id, timestamp: result.createdAt, ownerToken };
}

/**
 * Delete a cloud project by its cloudId.
 * @throws If owner token is missing or the API call fails.
 */
export async function deleteProjectFromCloudImpl(cloudId: string, jwt?: string | null): Promise<void> {
  const ownerToken = getOwnerTokenForProject(cloudId);
  const tokenHash = ownerToken ? await hashOwnerToken(ownerToken) : '';
  if (!ownerToken && !jwt) {
    throw new Error('Owner token not found.');
  }
  await apiDeleteProject(cloudId, tokenHash, jwt ?? undefined);
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
  const ownerToken = getOwnerTokenForProject(cloudId);
  const tokenHash = ownerToken ? await hashOwnerToken(ownerToken) : '';
  if (!ownerToken && !jwt) {
    throw new Error('Owner token not found.');
  }
  await apiPatchVisibility(cloudId, visibility, tokenHash, jwt ?? undefined);
}
