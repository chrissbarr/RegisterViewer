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
 * was anonymous (signed out, expired JWT), hit an old API during a non-atomic
 * deploy, or got a stale cached anonymous response (unlisted GETs are cached
 * for 60s). Never treat unknown ownership as non-ownership: doing so silently
 * unlinks owned cloud projects.
 */
export function isConfirmedNonOwner(result: Pick<CloudProjectLoadResult, 'isOwner' | 'authenticated'>): boolean {
  return result.authenticated === true && !result.isOwner;
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
