import { describe, it, expect } from 'vitest';
import { extractTokenHash, isOwner } from './auth';
import type { StoredProject } from './types';

describe('extractTokenHash', () => {
  it('extracts valid Bearer token hash', () => {
    const hash = 'a'.repeat(64);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: `Bearer ${hash}`,
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBe(hash);
  });

  it('returns null if Authorization header is missing', () => {
    const request = new Request('https://example.com');
    const result = extractTokenHash(request);
    expect(result).toBeNull();
  });

  it('returns null if Authorization header is not Bearer', () => {
    const request = new Request('https://example.com', {
      headers: {
        Authorization: 'Basic dXNlcjpwYXNz',
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBeNull();
  });

  it('returns null if Bearer token is malformed', () => {
    const request = new Request('https://example.com', {
      headers: {
        Authorization: 'Bearer',
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBeNull();
  });

  it('returns null if hash is not 64 characters', () => {
    const shortHash = 'a'.repeat(63);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: `Bearer ${shortHash}`,
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBeNull();
  });

  it('returns null if hash contains non-hex characters', () => {
    const invalidHash = 'g'.repeat(64);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: `Bearer ${invalidHash}`,
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBeNull();
  });

  it('normalizes uppercase hash to lowercase', () => {
    const uppercaseHash = 'A'.repeat(64);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: `Bearer ${uppercaseHash}`,
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBe(uppercaseHash.toLowerCase());
  });

  it('normalizes mixed-case hash to lowercase', () => {
    const mixedCaseHash = 'AbCdEf0123456789'.repeat(4);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: `Bearer ${mixedCaseHash}`,
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBe(mixedCaseHash.toLowerCase());
  });

  it('returns null if Authorization has extra parts', () => {
    const hash = 'a'.repeat(64);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: `Bearer ${hash} extra`,
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBeNull();
  });

  it('returns null if Authorization header is empty', () => {
    const request = new Request('https://example.com', {
      headers: {
        Authorization: '',
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBeNull();
  });

  it('handles hash with all valid hex characters', () => {
    const hash = '0123456789abcdef'.repeat(4);
    const request = new Request('https://example.com', {
      headers: {
        Authorization: `Bearer ${hash}`,
      },
    });

    const result = extractTokenHash(request);
    expect(result).toBe(hash);
  });
});

describe('isOwner', () => {
  const createProject = (ownerTokenHash: string): StoredProject => ({
    schemaVersion: 1,
    id: 'test-project',
    ownerTokenHash,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    lastAccessedAt: '2024-01-01T00:00:00Z',
    data: {
      version: 1,
      registers: [],
      registerValues: {},
    },
  });

  it('returns true for matching hash', () => {
    const hash = 'a'.repeat(64);
    const project = createProject(hash);

    expect(isOwner(hash, project)).toBe(true);
  });

  it('returns false for non-matching hash', () => {
    const correctHash = 'a'.repeat(64);
    const wrongHash = 'b'.repeat(64);
    const project = createProject(correctHash);

    expect(isOwner(wrongHash, project)).toBe(false);
  });

  it('returns false for empty hash', () => {
    const project = createProject('a'.repeat(64));
    expect(isOwner('', project)).toBe(false);
  });

  it('returns false if project hash is empty', () => {
    const project = createProject('');
    expect(isOwner('a'.repeat(64), project)).toBe(false);
  });

  it('returns false for hashes of different lengths', () => {
    const project = createProject('a'.repeat(64));
    expect(isOwner('a'.repeat(63), project)).toBe(false);
  });

  it('is case-sensitive', () => {
    const project = createProject('a'.repeat(64));
    expect(isOwner('A'.repeat(64), project)).toBe(false);
  });

  it('performs constant-time comparison (same length inputs)', () => {
    // This test ensures the function uses constant-time comparison
    // We can't directly test timing, but we can verify it compares all characters
    const hash1 = 'a'.repeat(64);
    const hash2 = 'b'.repeat(64);
    const hash3 = 'a'.repeat(63) + 'b'; // Differs only in last character

    const project1 = createProject(hash1);
    const project2 = createProject(hash2);
    const project3 = createProject(hash3);

    expect(isOwner(hash1, project1)).toBe(true);
    expect(isOwner(hash1, project2)).toBe(false);
    expect(isOwner(hash1, project3)).toBe(false);
  });

  it('handles all hex characters correctly', () => {
    const validHashes = [
      '0'.repeat(64),
      '1'.repeat(64),
      '9'.repeat(64),
      'a'.repeat(64),
      'f'.repeat(64),
      '0123456789abcdef'.repeat(4),
    ];

    validHashes.forEach((hash) => {
      const project = createProject(hash);
      expect(isOwner(hash, project)).toBe(true);
      expect(isOwner('x'.repeat(64), project)).toBe(false);
    });
  });

  it('returns false when one character differs', () => {
    const baseHash = 'a'.repeat(64);

    // Test differing character at various positions
    const positions = [0, 1, 31, 32, 63];

    positions.forEach((pos) => {
      const differentHash =
        baseHash.substring(0, pos) + 'b' + baseHash.substring(pos + 1);
      const project = createProject(baseHash);

      expect(isOwner(differentHash, project)).toBe(false);
    });
  });

  it('is consistent across multiple calls', () => {
    const hash = 'a'.repeat(64);
    const project = createProject(hash);

    // Call multiple times with same inputs
    expect(isOwner(hash, project)).toBe(true);
    expect(isOwner(hash, project)).toBe(true);
    expect(isOwner(hash, project)).toBe(true);

    const wrongHash = 'b'.repeat(64);
    expect(isOwner(wrongHash, project)).toBe(false);
    expect(isOwner(wrongHash, project)).toBe(false);
  });

  it('handles numeric hex characters', () => {
    const project = createProject('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

    expect(
      isOwner(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        project,
      ),
    ).toBe(true);

    expect(
      isOwner(
        '1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        project,
      ),
    ).toBe(false);
  });
});
