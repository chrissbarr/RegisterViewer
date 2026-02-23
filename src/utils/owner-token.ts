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

export function checkOwnership(cloudId: string): boolean {
  const manifest = loadManifest();
  const entry = manifest.projects.find(p => p.cloudId === cloudId);
  if (!entry) return false;
  const project = loadProject(entry.localId);
  return project?.ownerToken != null;
}

export function getOwnerTokenForProject(cloudId: string): string | null {
  const manifest = loadManifest();
  const entry = manifest.projects.find(p => p.cloudId === cloudId);
  if (!entry) return null;
  const project = loadProject(entry.localId);
  return project?.ownerToken ?? null;
}
