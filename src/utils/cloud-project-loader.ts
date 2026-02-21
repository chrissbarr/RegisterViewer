import { getProject } from './api-client';
import { importFromJson, type ImportResult } from './storage';

export interface CloudProjectLoadResult extends ImportResult {
  updatedAt: string;
}

/**
 * Shared fetch + parse logic for loading a cloud project.
 * Both the initial page-load path (AppLoader) and the in-context
 * navigation path (CloudProjectProvider.loadProject) call this,
 * ensuring consistent data handling.
 */
export async function fetchAndParseCloudProject(id: string): Promise<CloudProjectLoadResult> {
  const result = await getProject(id);

  // The API returns `data` as a parsed object (from res.json()),
  // but importFromJson expects a JSON string. Normalize here.
  const jsonString =
    typeof result.data === 'string' ? result.data : JSON.stringify(result.data);

  const importResult = importFromJson(jsonString);
  if (!importResult || importResult.registers.length === 0) {
    throw new Error('Failed to parse project data from cloud.');
  }
  return { ...importResult, updatedAt: result.updatedAt };
}
