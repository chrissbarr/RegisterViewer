import { formatOffset, offsetHexDigits, formatBinary } from './format';

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
