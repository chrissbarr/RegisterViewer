import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  generateOwnerToken,
  hashOwnerToken,
  getOrCreateOwnerToken,
  checkOwnership,
  getOwnerTokenForProject,
} from './owner-token';

describe('generateOwnerToken', () => {
  it('generates a 64-character hex string', () => {
    const token = generateOwnerToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates different tokens on each call', () => {
    const token1 = generateOwnerToken();
    const token2 = generateOwnerToken();
    const token3 = generateOwnerToken();

    expect(token1).not.toBe(token2);
    expect(token2).not.toBe(token3);
    expect(token1).not.toBe(token3);
  });

  it('uses only lowercase hex characters', () => {
    const token = generateOwnerToken();
    expect(token).toBe(token.toLowerCase());
    expect(token).not.toContain('g');
    expect(token).not.toContain('G');
  });

  it('generates tokens with good entropy (no obvious patterns)', () => {
    const tokens = Array.from({ length: 10 }, () => generateOwnerToken());

    // All should be unique
    const uniqueTokens = new Set(tokens);
    expect(uniqueTokens.size).toBe(10);

    // None should be all zeros or all the same character
    tokens.forEach((token) => {
      expect(token).not.toBe('0'.repeat(64));
      const firstChar = token[0];
      expect(token).not.toBe(firstChar.repeat(64));
    });
  });
});

describe('hashOwnerToken', () => {
  it('hashes a token to a 64-character hex string', async () => {
    const token = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    const hash = await hashOwnerToken(token);

    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces consistent hash for the same input', async () => {
    const token = generateOwnerToken();
    const hash1 = await hashOwnerToken(token);
    const hash2 = await hashOwnerToken(token);

    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', async () => {
    const token1 = 'a'.repeat(64);
    const token2 = 'b'.repeat(64);

    const hash1 = await hashOwnerToken(token1);
    const hash2 = await hashOwnerToken(token2);

    expect(hash1).not.toBe(hash2);
  });

  it('hashes empty string to valid format', async () => {
    const hash = await hashOwnerToken('');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes non-hex strings', async () => {
    const hash1 = await hashOwnerToken('hello world');
    const hash2 = await hashOwnerToken('测试');

    expect(hash1).toHaveLength(64);
    expect(hash2).toHaveLength(64);
    expect(hash1).not.toBe(hash2);
  });

  it('produces SHA-256 hash', async () => {
    // Known SHA-256 hash of "test"
    const hash = await hashOwnerToken('test');
    const expected =
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

    expect(hash).toBe(expected);
  });
});

describe('getOrCreateOwnerToken', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('creates and stores a new token if none exists', () => {
    const token = getOrCreateOwnerToken();

    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(localStorage.getItem('register-viewer-owner-token')).toBe(token);
  });

  it('returns existing token if already stored', () => {
    const existingToken = 'a'.repeat(64);
    localStorage.setItem('register-viewer-owner-token', existingToken);

    const token = getOrCreateOwnerToken();

    expect(token).toBe(existingToken);
    // Should not have changed
    expect(localStorage.getItem('register-viewer-owner-token')).toBe(
      existingToken,
    );
  });

  it('creates new token if stored token has invalid length', () => {
    localStorage.setItem('register-viewer-owner-token', 'invalid');

    const token = getOrCreateOwnerToken();

    expect(token).toHaveLength(64);
    expect(token).not.toBe('invalid');
    expect(localStorage.getItem('register-viewer-owner-token')).toBe(token);
  });

  it('creates new token if stored token is empty', () => {
    localStorage.setItem('register-viewer-owner-token', '');

    const token = getOrCreateOwnerToken();

    expect(token).toHaveLength(64);
    expect(localStorage.getItem('register-viewer-owner-token')).toBe(token);
  });

  it('creates new token if stored token is too short', () => {
    localStorage.setItem('register-viewer-owner-token', 'a'.repeat(63));

    const token = getOrCreateOwnerToken();

    expect(token).toHaveLength(64);
    expect(localStorage.getItem('register-viewer-owner-token')).toBe(token);
  });

  it('creates new token if stored token is too long', () => {
    localStorage.setItem('register-viewer-owner-token', 'a'.repeat(65));

    const token = getOrCreateOwnerToken();

    expect(token).toHaveLength(64);
    expect(localStorage.getItem('register-viewer-owner-token')).toBe(token);
  });

  it('returns same token on multiple calls', () => {
    const token1 = getOrCreateOwnerToken();
    const token2 = getOrCreateOwnerToken();
    const token3 = getOrCreateOwnerToken();

    expect(token1).toBe(token2);
    expect(token2).toBe(token3);
  });

  it('handles localStorage errors gracefully', () => {
    // Mock localStorage.getItem to throw
    const getItemSpy = vi
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation(() => {
        throw new Error('localStorage not available');
      });

    const token = getOrCreateOwnerToken();

    // Should still generate a valid token
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    getItemSpy.mockRestore();
  });

  it('generates new token if localStorage setItem fails', () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('quota exceeded');
      });

    const token = getOrCreateOwnerToken();

    // Should still return a valid token even if storage fails
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    setItemSpy.mockRestore();
  });
});

describe('checkOwnership', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns true if project is in local storage', () => {
    const projects = [
      {
        id: 'ABC123DEF456',
        ownerToken: 'a'.repeat(64),
        name: 'Test Project',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/ABC123DEF456',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(projects));

    expect(checkOwnership('ABC123DEF456')).toBe(true);
  });

  it('returns false if project is not in local storage', () => {
    const projects = [
      {
        id: 'ABC123DEF456',
        ownerToken: 'a'.repeat(64),
        name: 'Test Project',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/ABC123DEF456',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(projects));

    expect(checkOwnership('XYZ789GHI012')).toBe(false);
  });

  it('returns false if no projects exist', () => {
    expect(checkOwnership('ABC123DEF456')).toBe(false);
  });

  it('handles malformed localStorage gracefully', () => {
    localStorage.setItem('register-viewer-projects', 'invalid json');
    expect(checkOwnership('ABC123DEF456')).toBe(false);
  });
});

describe('getOwnerTokenForProject', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns token if project exists', () => {
    const token = 'a'.repeat(64);
    const projects = [
      {
        id: 'ABC123DEF456',
        ownerToken: token,
        name: 'Test Project',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/ABC123DEF456',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(projects));

    expect(getOwnerTokenForProject('ABC123DEF456')).toBe(token);
  });

  it('returns null if project does not exist', () => {
    const projects = [
      {
        id: 'ABC123DEF456',
        ownerToken: 'a'.repeat(64),
        name: 'Test Project',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/ABC123DEF456',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(projects));

    expect(getOwnerTokenForProject('XYZ789GHI012')).toBeNull();
  });

  it('returns null if no projects exist', () => {
    expect(getOwnerTokenForProject('ABC123DEF456')).toBeNull();
  });

  it('returns correct token when multiple projects exist', () => {
    const token1 = 'a'.repeat(64);
    const token2 = 'b'.repeat(64);
    const token3 = 'c'.repeat(64);

    const projects = [
      {
        id: 'PROJECT1',
        ownerToken: token1,
        name: 'Project 1',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT1',
      },
      {
        id: 'PROJECT2',
        ownerToken: token2,
        name: 'Project 2',
        savedAt: '2024-01-02T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT2',
      },
      {
        id: 'PROJECT3',
        ownerToken: token3,
        name: 'Project 3',
        savedAt: '2024-01-03T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT3',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(projects));

    expect(getOwnerTokenForProject('PROJECT1')).toBe(token1);
    expect(getOwnerTokenForProject('PROJECT2')).toBe(token2);
    expect(getOwnerTokenForProject('PROJECT3')).toBe(token3);
  });

  it('handles malformed localStorage gracefully', () => {
    localStorage.setItem('register-viewer-projects', 'invalid json');
    expect(getOwnerTokenForProject('ABC123DEF456')).toBeNull();
  });
});
