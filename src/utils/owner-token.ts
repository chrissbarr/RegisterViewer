import { loadLocalProjects } from './cloud-projects';

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

export function checkOwnership(projectId: string): boolean {
  const projects = loadLocalProjects();
  return projects.some((p) => p.id === projectId);
}

export function getOwnerTokenForProject(projectId: string): string | null {
  const projects = loadLocalProjects();
  const record = projects.find((p) => p.id === projectId);
  return record?.ownerToken ?? null;
}
