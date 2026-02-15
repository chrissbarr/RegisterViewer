import { formatOffset } from './format';

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
});
