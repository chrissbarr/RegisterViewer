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
): Promise<SaveResult> {
  if (existingCloudId) {
    const ownerToken = getOwnerTokenForProject(existingCloudId);
    if (!ownerToken) {
      throw new Error('Owner token not found for this project.');
    }
    const tokenHash = await hashOwnerToken(ownerToken);
    try {
      const result = await apiUpdateProject(existingCloudId, jsonPayload, tokenHash);
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
  const result = await apiCreateProject(jsonPayload, tokenHash);
  return { kind: 'created', cloudId: result.id, timestamp: result.createdAt, ownerToken };
}

/**
 * Delete a cloud project by its cloudId.
 * @throws If owner token is missing or the API call fails.
 */
export async function deleteProjectFromCloudImpl(cloudId: string): Promise<void> {
  const ownerToken = getOwnerTokenForProject(cloudId);
  if (!ownerToken) {
    throw new Error('Owner token not found.');
  }
  const tokenHash = await hashOwnerToken(ownerToken);
  await apiDeleteProject(cloudId, tokenHash);
}

/**
 * Patch the visibility of a cloud project using the PATCH endpoint.
 * @throws If owner token is missing or the API call fails.
 */
export async function patchVisibilityImpl(
  cloudId: string,
  visibility: Visibility,
): Promise<void> {
  const ownerToken = getOwnerTokenForProject(cloudId);
  if (!ownerToken) {
    throw new Error('Owner token not found.');
  }
  const tokenHash = await hashOwnerToken(ownerToken);
  await apiPatchVisibility(cloudId, visibility, tokenHash);
}
