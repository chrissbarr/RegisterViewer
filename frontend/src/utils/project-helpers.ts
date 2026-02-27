import { DEFAULT_PROJECT_NAME } from '../types/project';

/** Returns the project name, falling back to DEFAULT_PROJECT_NAME for empty/missing values */
export function projectDisplayName(name: string | null | undefined): string {
  return name?.trim() || DEFAULT_PROJECT_NAME;
}
