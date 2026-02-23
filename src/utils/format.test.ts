import { formatOffset, offsetHexDigits, formatBinary, formatRelativeTime } from './format';

describe('formatOffset', () => {
  it('formats zero as 0x00', () => {
    expect(formatOffset(0)).toBe('0x00');
  });

  it('formats single-digit offset with leading zero', () => {
    expect(formatOffset(4)).toBe('0x04');
  });

  it('formats 0xFF correctly', () => {
    expect(formatOffset(0xFF)).toBe('0xFF');
  });

  it('formats values above 0xFF without extra padding', () => {
    expect(formatOffset(0x100)).toBe('0x100');
  });

  it('formats large offsets correctly', () => {
    expect(formatOffset(0xDEAD)).toBe('0xDEAD');
  });

  it('pads to minDigits when specified', () => {
    expect(formatOffset(0, 4)).toBe('0x0000');
    expect(formatOffset(0xFF, 4)).toBe('0x00FF');
    expect(formatOffset(0x100, 4)).toBe('0x0100');
  });

  it('does not truncate when value exceeds minDigits', () => {
    expect(formatOffset(0xABCD, 2)).toBe('0xABCD');
  });
});

describe('offsetHexDigits', () => {
  it('returns 2 for zero', () => {
    expect(offsetHexDigits(0)).toBe(2);
  });

  it('returns 2 for small offsets', () => {
    expect(offsetHexDigits(0xFF)).toBe(2);
  });

  it('returns 3 for offsets requiring 3 hex digits', () => {
    expect(offsetHexDigits(0x100)).toBe(3);
    expect(offsetHexDigits(0xFFF)).toBe(3);
  });

  it('returns 4 for offsets requiring 4 hex digits', () => {
    expect(offsetHexDigits(0x1000)).toBe(4);
    expect(offsetHexDigits(0xFFFF)).toBe(4);
  });
});

describe('formatBinary', () => {
  it('groups 8-bit string', () => {
    expect(formatBinary('10101011')).toBe('1010 1011');
  });

  it('groups 16-bit string', () => {
    expect(formatBinary('1101111010101101')).toBe('1101 1110 1010 1101');
  });

  it('handles non-multiple-of-4 length', () => {
    expect(formatBinary('110101')).toBe('11 0101');
  });

  it('handles single character', () => {
    expect(formatBinary('1')).toBe('1');
  });

  it('handles empty string', () => {
    expect(formatBinary('')).toBe('');
  });

  it('handles 4-char string (no spaces needed)', () => {
    expect(formatBinary('1010')).toBe('1010');
  });
});

describe('formatRelativeTime', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString();
    expect(formatRelativeTime(now)).toBe('just now');
  });

  it('returns minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatRelativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('returns hours ago', () => {
    const threeHrAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeHrAgo)).toBe('3h ago');
  });

  it('returns "yesterday" for 1 day ago', () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(yesterday)).toBe('yesterday');
  });

  it('returns days ago for 2-6 days', () => {
    const threeDays = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeDays)).toBe('3d ago');
  });

  it('returns formatted date for older timestamps', () => {
    const twoWeeks = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const result = formatRelativeTime(twoWeeks);
    // Should be a locale-formatted date like "Feb 10"
    expect(result).not.toMatch(/ago$/);
    expect(result).not.toBe('just now');
  });

  it('handles invalid date gracefully', () => {
    // new Date('not-a-date') may produce NaN or throw depending on environment
    const result = formatRelativeTime('not-a-date');
    expect(typeof result).toBe('string');
  });
});
