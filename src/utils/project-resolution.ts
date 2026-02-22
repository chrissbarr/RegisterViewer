import type { ProjectManifest } from '../types/project';

type ProjectResolution =
  | { type: 'cloud'; cloudId: string }
  | { type: 'snapshot'; data: string }
  | { type: 'local'; localId: string }
  | { type: 'create-default' };

/**
 * Determine what project to load on startup.
 * Pure function — no side effects, fully unit-testable.
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
  if (manifest.projects.length > 0) {
    const sorted = [...manifest.projects].sort(
      (a, b) => new Date(b.localSavedAt).getTime() - new Date(a.localSavedAt).getTime(),
    );
    return { type: 'local', localId: sorted[0].localId };
  }

  // 5. No projects exist — create default
  return { type: 'create-default' };
}
