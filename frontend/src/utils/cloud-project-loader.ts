import { getProject } from './api-client';
import { importFromObject, type ImportResult } from './storage';

interface CloudProjectLoadResult extends ImportResult {
  updatedAt: string;
  isOwner: boolean;
  version: number;
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
  return { ...parsed, updatedAt: result.updatedAt, isOwner: result.isOwner, version: result.version };
}
