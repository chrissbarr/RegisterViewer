/**
 * Owner token security model:
 *
 * Each browser gets a random 256-bit token stored in localStorage. This token
 * proves ownership of cloud projects without requiring user accounts.
 *
 * - The raw token is sent to the server only for write operations (create,
 *   update, delete, patch visibility). The server hashes it with SHA-256 and
 *   compares against the stored hash using constant-time comparison.
 * - The raw token is NEVER stored server-side; only the SHA-256 hash is persisted.
 * - Per-project ownerToken copies are stored in StoredLocalProject records
 *   so ownership can survive localStorage key migration.
 * - Ownership check (checkOwnership) is local-only: it verifies a local project
 *   record exists with an ownerToken for the given cloudId.
 */
import { loadManifest, loadProject } from './project-storage';

const OWNER_TOKEN_KEY = 'register-viewer-owner-token';

export function generateOwnerToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function hashOwnerToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function getOrCreateOwnerToken(): string {
  try {
    const existing = localStorage.getItem(OWNER_TOKEN_KEY);
    if (existing && existing.length === 64) return existing;
    const token = generateOwnerToken();
    localStorage.setItem(OWNER_TOKEN_KEY, token);
    return token;
  } catch {
    return generateOwnerToken();
  }
}

function findProjectByCloudId(cloudId: string) {
  const manifest = loadManifest();
  const entry = manifest.projects.find(p => p.cloudId === cloudId);
  if (!entry) return null;
  return loadProject(entry.localId);
}

export function checkOwnership(cloudId: string): boolean {
  return findProjectByCloudId(cloudId)?.ownerToken != null;
}

export function getOwnerTokenForProject(cloudId: string): string | null {
  return findProjectByCloudId(cloudId)?.ownerToken ?? null;
}
