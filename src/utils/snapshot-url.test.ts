import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  compressSnapshot,
  decompressSnapshot,
  buildSnapshotUrl,
  isSnapshotHash,
  isProjectHash,
} from './snapshot-url';
import { makeState, makeRegister } from '../test/helpers';

describe('compressSnapshot / decompressSnapshot', () => {
  describe('round-trip encoding', () => {
    it('round-trips a simple JSON string', () => {
      const json = '{"version":1,"registers":[]}';
      const compressed = compressSnapshot(json);
      const decompressed = decompressSnapshot(compressed);
      expect(decompressed).toBe(json);
    });

    it('round-trips a complex JSON string', () => {
      const json = JSON.stringify({
        version: 1,
        registers: [
          {
            id: 'reg-1',
            name: 'TEST_REG',
            width: 32,
            fields: [
              { id: 'f1', name: 'FIELD1', msb: 7, lsb: 0, type: 'integer' },
            ],
          },
        ],
        registerValues: { 'reg-1': '0xFF' },
      });
      const compressed = compressSnapshot(json);
      const decompressed = decompressSnapshot(compressed);
      expect(decompressed).toBe(json);
    });

    it('round-trips an empty object', () => {
      const json = '{}';
      const compressed = compressSnapshot(json);
      const decompressed = decompressSnapshot(compressed);
      expect(decompressed).toBe(json);
    });

    it('round-trips unicode characters', () => {
      const json = '{"name":"测试","emoji":"🚀"}';
      const compressed = compressSnapshot(json);
      const decompressed = decompressSnapshot(compressed);
      expect(decompressed).toBe(json);
    });

    it('produces URL-safe base64 (no +, /, or =)', () => {
      const json = '{"test":"data with lots of repetition to trigger compression"}';
      const compressed = compressSnapshot(json);
      expect(compressed).not.toContain('+');
      expect(compressed).not.toContain('/');
      expect(compressed).not.toContain('=');
    });

    it('compresses repetitive data efficiently', () => {
      const repetitive = 'a'.repeat(1000);
      const json = JSON.stringify({ data: repetitive });
      const compressed = compressSnapshot(json);
      // Compressed should be much smaller than original
      expect(compressed.length).toBeLessThan(json.length / 2);
    });
  });

  describe('edge cases', () => {
    it('handles very long JSON strings', () => {
      const longArray = Array(100)
        .fill(null)
        .map((_, i) => ({ id: `item-${i}`, value: i }));
      const json = JSON.stringify({ items: longArray });
      const compressed = compressSnapshot(json);
      const decompressed = decompressSnapshot(compressed);
      expect(decompressed).toBe(json);
    });

    it('handles special characters in JSON', () => {
      const json = '{"special":"\\n\\t\\r\\"\\\\"}';
      const compressed = compressSnapshot(json);
      const decompressed = decompressSnapshot(compressed);
      expect(decompressed).toBe(json);
    });
  });
});

describe('buildSnapshotUrl', () => {
  const originalHref = window.location.href;

  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, href: 'https://example.com/app' },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, href: originalHref },
    });
  });

  it('builds a URL with compressed state in hash fragment', () => {
    const state = makeState({
      registers: [makeRegister({ id: 'reg-1', name: 'TEST' })],
      registerValues: { 'reg-1': 0xFFn },
    });

    const url = buildSnapshotUrl(state);

    expect(url).toMatch(/^https:\/\/example\.com\/app#data=.+/);
    expect(url).toContain('#data=');
  });

  it('strips existing hash from base URL', () => {
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, href: 'https://example.com/app#existing-hash' },
    });

    const state = makeState();
    const url = buildSnapshotUrl(state);

    // Should strip existing hash and add snapshot data
    expect(url).toMatch(/^https:\/\/example\.com\/app#data=.+/);
    expect(url).not.toContain('#existing-hash');
  });

  it('produces a decodable URL', () => {
    const state = makeState({
      registers: [
        makeRegister({
          id: 'reg-1',
          name: 'CONTROL',
          width: 8,
          fields: [],
        }),
      ],
      registerValues: { 'reg-1': 0xAAn },
    });

    const url = buildSnapshotUrl(state);
    const hashPart = url.split('#data=')[1];

    expect(hashPart).toBeDefined();
    const decoded = decompressSnapshot(hashPart);
    const parsed = JSON.parse(decoded);

    expect(parsed.version).toBe(1);
    expect(parsed.registers).toHaveLength(1);
    expect(parsed.registers[0].name).toBe('CONTROL');
    // exportToJson uses register names as keys, not IDs
    expect(parsed.registerValues['CONTROL']).toBe('0xaa');
  });
});

describe('isSnapshotHash', () => {
  it('returns true for snapshot hash format', () => {
    expect(isSnapshotHash('#data=abc123')).toBe(true);
    expect(isSnapshotHash('#data=eJwLSS0uAQAEUAFE')).toBe(true);
  });

  it('returns false for empty data', () => {
    expect(isSnapshotHash('#data=')).toBe(false);
  });

  it('returns false for non-snapshot hash', () => {
    expect(isSnapshotHash('#some-other-hash')).toBe(false);
    expect(isSnapshotHash('#/p/ABC123DEF456')).toBe(false);
    expect(isSnapshotHash('')).toBe(false);
    expect(isSnapshotHash('#')).toBe(false);
  });

  it('returns false for malformed snapshot hash', () => {
    expect(isSnapshotHash('data=abc')).toBe(false);
    expect(isSnapshotHash('#databc')).toBe(false);
  });
});

describe('isProjectHash', () => {
  it('returns true for valid project hash format', () => {
    expect(isProjectHash('#/p/ABC123DEF456')).toBe(true);
    expect(isProjectHash('#/p/abcdefghijkl')).toBe(true);
    expect(isProjectHash('#/p/0123456789AB')).toBe(true);
    expect(isProjectHash('#/p/aB1cD2eF3gH4')).toBe(true);
  });

  it('returns false for wrong length project ID', () => {
    expect(isProjectHash('#/p/ABC123')).toBe(false); // too short
    expect(isProjectHash('#/p/ABC123DEF456789')).toBe(false); // too long
    expect(isProjectHash('#/p/ABC123DEF45')).toBe(false); // 11 chars
  });

  it('returns false for invalid characters in project ID', () => {
    expect(isProjectHash('#/p/ABC123DEF45-')).toBe(false); // dash
    expect(isProjectHash('#/p/ABC123DEF45_')).toBe(false); // underscore
    expect(isProjectHash('#/p/ABC123DEF45@')).toBe(false); // special char
  });

  it('returns false for non-project hash', () => {
    expect(isProjectHash('#data=abc123')).toBe(false);
    expect(isProjectHash('#some-other-hash')).toBe(false);
    expect(isProjectHash('')).toBe(false);
    expect(isProjectHash('#')).toBe(false);
  });

  it('returns false for malformed project hash', () => {
    expect(isProjectHash('/p/ABC123DEF456')).toBe(false); // missing #
    expect(isProjectHash('#p/ABC123DEF456')).toBe(false); // missing /
    expect(isProjectHash('#/ABC123DEF456')).toBe(false); // missing p/
  });
});
