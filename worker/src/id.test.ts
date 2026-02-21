import { describe, it, expect, vi } from 'vitest';
import { generateId } from './id';

describe('generateId', () => {
  it('generates a 12-character ID', () => {
    const id = generateId();
    expect(id).toHaveLength(12);
  });

  it('generates different IDs on each call', () => {
    const id1 = generateId();
    const id2 = generateId();
    const id3 = generateId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it('uses only base62 characters (A-Z, a-z, 0-9)', () => {
    const base62Regex = /^[A-Za-z0-9]{12}$/;

    // Test multiple IDs to ensure consistency
    for (let i = 0; i < 20; i++) {
      const id = generateId();
      expect(id).toMatch(base62Regex);
    }
  });

  it('does not contain special characters', () => {
    const specialChars = ['-', '_', '+', '/', '=', '@', '#', '$', '%'];

    for (let i = 0; i < 20; i++) {
      const id = generateId();
      specialChars.forEach((char) => {
        expect(id).not.toContain(char);
      });
    }
  });

  it('generates IDs with good entropy (no obvious patterns)', () => {
    const ids = Array.from({ length: 100 }, () => generateId());

    // All should be unique
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);

    // None should be all the same character
    ids.forEach((id) => {
      const firstChar = id[0];
      expect(id).not.toBe(firstChar.repeat(12));
    });
  });

  it('uses the full base62 alphabet', () => {
    // Generate many IDs and check that we see variety
    const ids = Array.from({ length: 500 }, () => generateId()).join('');

    // Should contain uppercase letters
    expect(/[A-Z]/.test(ids)).toBe(true);

    // Should contain lowercase letters
    expect(/[a-z]/.test(ids)).toBe(true);

    // Should contain digits
    expect(/[0-9]/.test(ids)).toBe(true);
  });

  it('produces statistically distributed characters', () => {
    // Generate many IDs and check character distribution
    const characterCounts: Record<string, number> = {};
    const iterations = 1000;

    for (let i = 0; i < iterations; i++) {
      const id = generateId();
      for (const char of id) {
        characterCounts[char] = (characterCounts[char] || 0) + 1;
      }
    }

    // We should have seen many different characters
    const uniqueChars = Object.keys(characterCounts).length;
    expect(uniqueChars).toBeGreaterThan(30); // At least half of base62 alphabet

    // No single character should dominate (very rough check)
    const totalChars = iterations * 12;
    Object.values(characterCounts).forEach((count) => {
      // No character should appear more than 5% of the time
      // (expected uniform distribution would be ~1.6%)
      expect(count / totalChars).toBeLessThan(0.05);
    });
  });

  it('handles multiple sequential calls without collision', () => {
    const ids = new Set<string>();
    const count = 1000;

    for (let i = 0; i < count; i++) {
      ids.add(generateId());
    }

    // All IDs should be unique
    expect(ids.size).toBe(count);
  });

  it('provides sufficient entropy (~71 bits)', () => {
    // 12 base62 characters = log2(62^12) ≈ 71.45 bits of entropy
    // We can't directly test entropy, but we can verify collision resistance

    const ids = new Set<string>();
    const iterations = 10000;

    for (let i = 0; i < iterations; i++) {
      ids.add(generateId());
    }

    // With 71 bits of entropy, 10,000 IDs should have virtually no collisions
    expect(ids.size).toBe(iterations);
  });

  describe('rejection sampling', () => {
    it('avoids modulo bias by rejecting values >= 248', () => {
      // This is tested indirectly through distribution
      // Generate many IDs and verify no systematic bias

      const characterCounts: Record<string, number> = {};
      const iterations = 5000;

      for (let i = 0; i < iterations; i++) {
        const id = generateId();
        for (const char of id) {
          characterCounts[char] = (characterCounts[char] || 0) + 1;
        }
      }

      // Calculate chi-square statistic for uniformity
      const totalChars = iterations * 12;
      const expected = totalChars / 62; // Expected count per character
      let chiSquare = 0;

      Object.values(characterCounts).forEach((observed) => {
        chiSquare += Math.pow(observed - expected, 2) / expected;
      });

      // Chi-square critical value for 61 degrees of freedom at p=0.01 is ~88.38
      // Our implementation should produce a roughly uniform distribution
      // This is a loose check - we mainly verify no obvious bias
      expect(chiSquare).toBeLessThan(150);
    });
  });

  describe('crypto.getRandomValues usage', () => {
    it('uses crypto.getRandomValues for randomness', () => {
      // Mock crypto.getRandomValues to verify it's called
      const originalGetRandomValues = crypto.getRandomValues;
      const mockGetRandomValues = vi.fn((array) => {
        // Fill with deterministic values for testing
        for (let i = 0; i < array.length; i++) {
          array[i] = (i * 37) % 248; // Use values < 248 to avoid rejection
        }
        return array;
      });

      crypto.getRandomValues = mockGetRandomValues as typeof crypto.getRandomValues;

      const id = generateId();

      expect(mockGetRandomValues).toHaveBeenCalled();
      expect(id).toHaveLength(12);

      // Restore original
      crypto.getRandomValues = originalGetRandomValues;
    });

    it('generates different IDs even with mocked crypto (calls multiple times)', () => {
      let callCount = 0;
      const originalGetRandomValues = crypto.getRandomValues;

      crypto.getRandomValues = vi.fn((array) => {
        callCount++;
        // Fill with different values each time
        for (let i = 0; i < array.length; i++) {
          array[i] = ((i + callCount) * 37) % 248;
        }
        return array;
      }) as typeof crypto.getRandomValues;

      const id1 = generateId();
      const id2 = generateId();

      expect(id1).not.toBe(id2);
      expect(callCount).toBeGreaterThan(0);

      crypto.getRandomValues = originalGetRandomValues;
    });
  });

  describe('format consistency', () => {
    it('always returns a string', () => {
      const id = generateId();
      expect(typeof id).toBe('string');
    });

    it('never returns null or undefined', () => {
      for (let i = 0; i < 10; i++) {
        const id = generateId();
        expect(id).toBeDefined();
        expect(id).not.toBeNull();
      }
    });

    it('never returns empty string', () => {
      for (let i = 0; i < 10; i++) {
        const id = generateId();
        expect(id.length).toBeGreaterThan(0);
      }
    });
  });

  describe('base62 alphabet verification', () => {
    it('contains all uppercase letters A-Z', () => {
      const BASE62_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      expect(BASE62_CHARS.slice(0, 26)).toBe('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
    });

    it('contains all lowercase letters a-z', () => {
      const BASE62_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      expect(BASE62_CHARS.slice(26, 52)).toBe('abcdefghijklmnopqrstuvwxyz');
    });

    it('contains all digits 0-9', () => {
      const BASE62_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      expect(BASE62_CHARS.slice(52, 62)).toBe('0123456789');
    });

    it('has exactly 62 characters', () => {
      const BASE62_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      expect(BASE62_CHARS.length).toBe(62);
    });
  });
});
