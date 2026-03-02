import { getProject } from './api-client';
import { importFromObject, type ImportResult } from './storage';

interface CloudProjectLoadResult extends ImportResult {
  updatedAt: string;
  isOwner: boolean;
}

/**
 * Shared fetch + parse logic for loading a cloud project.
 * Both the initial page-load path (AppLoader) and the in-context
 * navigation path (CloudProjectProvider.loadProject) call this,
 * ensuring consistent data handling.
 */
export async function fetchAndParseCloudProject(id: string, jwt?: string): Promise<CloudProjectLoadResult> {
  const result = await getProject(id, jwt);

  // The API returns `data` as a parsed object (from res.json()).
  // Use importFromObject directly to avoid re-serializing then re-parsing.
  const data = typeof result.data === 'string' ? JSON.parse(result.data) : result.data;

  const importResult = importFromObject(data as Record<string, unknown>);
  if (!importResult || importResult.registers.length === 0) {
    throw new Error('Failed to parse project data from cloud.');
  }
  return { ...importResult, updatedAt: result.updatedAt, isOwner: result.isOwner };
}
