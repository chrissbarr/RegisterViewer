import type { ProjectManifest } from '../types/project';
import { getMostRecentProjectId } from './project-storage';

type ProjectResolution =
  | { type: 'cloud'; cloudId: string }
  | { type: 'snapshot'; data: string }
  | { type: 'local'; localId: string }
  | { type: 'create-default' };

/**
 * Determine what project to load on startup.
 * Pure function — no side effects, fully unit-testable.
 *
 * Resolution priority:
 * 1. Snapshot URL (`#data=…`) — compressed state in the hash
 * 2. Cloud project link (`#/p/{id}`) — fetch from API server (if cloud enabled)
 * 3. Session-stored active project — tab isolation via sessionStorage
 * 4. Most recently saved local project from manifest
 * 5. Create a new default project (seed data)
 */
export function resolveInitialProject(
  hash: string,
  manifest: ProjectManifest,
  sessionActiveId: string | null,
  cloudEnabled: boolean,
): ProjectResolution {
  // 1. Snapshot URL: #data=...
  if (hash.startsWith('#data=')) {
    return { type: 'snapshot', data: hash.slice('#data='.length) };
  }

  // 2. Cloud project URL: #/p/{id} — only if cloud is enabled (review #23)
  if (cloudEnabled) {
    const cloudMatch = hash.match(/^#\/p\/([A-Za-z0-9]{12})$/);
    if (cloudMatch) {
      return { type: 'cloud', cloudId: cloudMatch[1] };
    }
  }

  // 3. sessionStorage active project (tab isolation)
  if (sessionActiveId) {
    const exists = manifest.projects.some(p => p.localId === sessionActiveId);
    if (exists) {
      return { type: 'local', localId: sessionActiveId };
    }
  }

  // 4. Most recent project from manifest
  const mostRecentId = getMostRecentProjectId(manifest);
  if (mostRecentId) {
    return { type: 'local', localId: mostRecentId };
  }

  // 5. No projects exist — create default
  return { type: 'create-default' };
}
