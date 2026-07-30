import { describe, it, expect } from 'vitest';
import { makeStressRegister, STRESS_32_8, STRESS_64_16, STRESS_128_32 } from './perf-fixtures';

describe('makeStressRegister', () => {
  it('creates a register with the correct width and field count', () => {
    const reg = makeStressRegister(64, 10);
    expect(reg.width).toBe(64);
    expect(reg.fields.length).toBe(10);
  });

  it('fields cover the entire bit range without gaps or overlaps', () => {
    for (const reg of [STRESS_32_8, STRESS_64_16, STRESS_128_32]) {
      const covered = new Set<number>();
      for (const field of reg.fields) {
        for (let b = field.lsb; b <= field.msb; b++) {
          expect(covered.has(b)).toBe(false);
          covered.add(b);
        }
      }
      expect(covered.size).toBe(reg.width);
    }
  });

  it('mixes field types across fields', () => {
    const types = new Set(STRESS_128_32.fields.map((f) => f.type));
    expect(types.size).toBeGreaterThanOrEqual(2);
  });

  it('pre-built fixtures have expected dimensions', () => {
    expect(STRESS_32_8.width).toBe(32);
    expect(STRESS_32_8.fields.length).toBe(8);
    expect(STRESS_64_16.width).toBe(64);
    expect(STRESS_64_16.fields.length).toBe(16);
    expect(STRESS_128_32.width).toBe(128);
    expect(STRESS_128_32.fields.length).toBe(32);
  });
});
