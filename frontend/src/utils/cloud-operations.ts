import {
  createProject as apiCreateProject,
  updateProject as apiUpdateProject,
  getProject as apiGetProject,
  getProjectMeta as apiGetProjectMeta,
  patchProjectVisibility as apiPatchVisibility,
  deleteProject as apiDeleteProject,
  getAuthMe as apiGetAuthMe,
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

type SaveAuthStaleResult = {
  kind: 'auth-stale';
};

export type SaveConflictResult = {
  kind: 'conflict';
  serverVersion: number;
};

type SaveResult =
  | SaveCreatedResult
  | SaveUpdatedResult
  | SaveNotFoundResult
  | SaveAuthStaleResult
  | SaveConflictResult;

/**
 * Disambiguate a probe-path double-404 via /auth/me (BR-6).
 *
 * `requireReadableProject` uniform-404s private projects when the JWT is DEAD
 * (revoked/expired/rotated `jwt_secret` all classify as `kind:'none'` — the
 * intentional IDOR defense), so a 404 from both the /meta probe and the
 * fallback GET does NOT prove the project was deleted. Extension of the A-2
 * positive-evidence policy: unlink only on server-verified deletion, so
 * `not-found` is returned only after /auth/me confirms the token is live.
 */
async function classifyAmbiguousNotFound(jwt: string): Promise<SaveNotFoundResult | SaveAuthStaleResult> {
  try {
    // The response's optional `refreshedToken` is intentionally ignored:
    // threading the auth context in here isn't worth it, and dropping it is
    // benign — AuthProvider's mount-time /auth/me validation refreshes
    // near-expiry tokens anyway.
    await apiGetAuthMe(jwt);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      // Dead token — the 404s proved nothing about the project.
      return { kind: 'auth-stale' };
    }
    // Network/other failure: the token could not be confirmed either way, so
    // the save fails (callers surface a generic save error that must not claim
    // deletion) and the cloud link is preserved — only a confirmed-live token
    // may unlink.
    throw err;
  }
  // Token is live, so the uniform 404 really means the project is gone:
  // server-verified deletion.
  return { kind: 'not-found' };
}

/**
 * Save project data to the cloud (create or update).
 *
 * Returns a discriminated union:
 * - `created` — new cloud project created
 * - `updated` — existing cloud project updated
 * - `not-found` — server-verified deletion (404 on update, or probe-path
 *   double-404 with a /auth/me-confirmed live token)
 * - `auth-stale` — probe-path double-404 with a dead JWT (/auth/me 401); the
 *   project's existence is unknown, so callers must NOT unlink
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
    // Unknown version: probe the current server version via /meta first, then
    // PUT with it. A known version PUTs directly — no extra round-trip. The
    // probe lives OUTSIDE the PUT's catch so its auth-ambiguous 404s are never
    // blindly mapped to `not-found` (BR-6).
    let putVersion = serverVersion;
    if (putVersion === undefined) {
      try {
        const currentMeta = await apiGetProjectMeta(existingCloudId, jwt);
        putVersion = currentMeta.version;
      } catch (err) {
        // PERMANENT old-API/genuine-404 funnel: an API deployed without the
        // /meta endpoint 404s the probe. Fall back once to the full GET.
        if (!(err instanceof ApiError && err.status === 404)) throw err;
        try {
          const current = await apiGetProject(existingCloudId, jwt);
          putVersion = current.version;
        } catch (getErr) {
          if (!(getErr instanceof ApiError && getErr.status === 404)) throw getErr;
          // Both the probe and the fallback GET 404'd: deleted project and
          // dead token are indistinguishable here — disambiguate via /auth/me.
          return classifyAmbiguousNotFound(jwt);
        }
      }
    }
    try {
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
          // Server-verified: the PUT runs through requireOwnership, which 401s
          // a dead token BEFORE the project lookup — this 404 proves deletion.
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
