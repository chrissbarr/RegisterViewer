import type { StoredProject } from './types';

const HEX_64_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Extract the SHA-256 token hash from the Authorization header.
 *
 * Expects: `Authorization: Bearer <64-char lowercase hex>`
 *
 * The client hashes the raw owner token with SHA-256 before sending it.
 * We never see or store the raw token — only its hash.
 *
 * Returns null if the header is missing, malformed, or the hash is invalid.
 */
export function extractTokenHash(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header) return null;

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  const hash = parts[1].toLowerCase();
  if (!HEX_64_PATTERN.test(hash)) return null;

  return hash;
}

/**
 * Check whether a token hash matches the project's owner token hash.
 *
 * Uses constant-time comparison to prevent timing side-channel attacks.
 * Both inputs are expected to be 64-character lowercase hex strings.
 */
export function isOwner(tokenHash: string, project: StoredProject): boolean {
  const a = tokenHash;
  const b = project.ownerTokenHash;

  // Length check — both should always be 64, but guard against misuse
  if (a.length !== b.length) return false;

  // Constant-time comparison: accumulate XOR differences
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}
