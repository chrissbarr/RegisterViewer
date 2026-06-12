import { getProject } from './api-client';
import { importFromObject, type ImportResult } from './storage';

interface CloudProjectLoadResult extends ImportResult {
  updatedAt: string;
  isOwner: boolean;
  /** True when the server verified a valid JWT on this request. Absent on older API responses. */
  authenticated?: boolean;
  visibility: import('../types/project').Visibility;
  version: number;
}

/**
 * Positive evidence of confirmed non-ownership: the server verified the
 * request's JWT (`authenticated:true`) AND the user is not the owner.
 *
 * A missing/false `authenticated` flag means "ownership unknown" — the request
 * was anonymous (signed out, expired JWT) or hit an old API during a
 * non-atomic deploy. Never treat unknown ownership as non-ownership: doing so
 * silently unlinks owned cloud projects.
 */
export function isConfirmedNonOwner(result: Pick<CloudProjectLoadResult, 'isOwner' | 'authenticated'>): boolean {
  return result.authenticated === true && !result.isOwner;
}

/**
 * The single ownership policy for persisting a freshly-fetched cloud project.
 *
 * Conservative: only demote to `'local'` (a full unlink) on POSITIVE evidence
 * of non-ownership (`isConfirmedNonOwner`). When ownership is unknown
 * (anonymous / expired-JWT / old-API), keep the manifest's storage class
 * rather than silently unlinking an owned project.
 *
 * Consumed by P1 (`persistDownloadedCloudProject`), the AppLoader
 * `treatAsShared` decision, and P5 (`loadCloudProject`) — so all fetch paths
 * share one ownership policy. (P1/treatAsShared already branched on
 * `isConfirmedNonOwner`; P5 was moved onto the conservative policy in the
 * consolidation, intentionally changing the unknown-ownership load to trust the
 * manifest instead of demoting on raw `isOwner`.)
 */
export function decideStorageForFetched(
  result: Pick<CloudProjectLoadResult, 'isOwner' | 'authenticated'>,
  manifestStorage: 'local' | 'cloud',
): 'local' | 'cloud' {
  return isConfirmedNonOwner(result) ? 'local' : manifestStorage;
}

/**
 * Parse raw project data (from API response) into app state.
 * Extracted from fetchAndParseCloudProject for reuse in freshness checks
 * to avoid double-fetching.
 */
export function parseProjectData(data: unknown): ImportResult | null {
  try {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const result = importFromObject(parsed as Record<string, unknown>);
    if (!result || result.registers.length === 0) return null;
    return result;
  } catch {
    return null;
  }
}

/**
 * Shared fetch + parse logic for loading a cloud project.
 * Both the initial page-load path (AppLoader) and the in-context
 * navigation path (CloudProjectProvider.loadProject) call this,
 * ensuring consistent data handling.
 */
export async function fetchAndParseCloudProject(id: string, jwt?: string): Promise<CloudProjectLoadResult> {
  const result = await getProject(id, jwt);
  const parsed = parseProjectData(result.data);
  if (!parsed) {
    throw new Error('Failed to parse project data from cloud.');
  }
  return {
    ...parsed,
    updatedAt: result.updatedAt,
    isOwner: result.isOwner,
    authenticated: result.authenticated,
    visibility: result.visibility,
    version: result.version,
  };
}
