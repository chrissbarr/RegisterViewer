import { describe, it, expect, vi } from 'vitest';
import { type MutableRefObject } from 'react';
import { withMutationLock, requireJwt } from './cloud-utils';

function makeRef(initial: boolean): MutableRefObject<boolean> {
  return { current: initial };
}

describe('withMutationLock', () => {
  it('executes fn and returns its result when lock is free', async () => {
    const ref = makeRef(false);
    const result = await withMutationLock(ref, async () => 42);
    expect(result).toEqual({ executed: true, result: 42 });
  });

  it('sets the lock before calling fn and releases it after', async () => {
    const ref = makeRef(false);
    let lockDuringFn: boolean | undefined;

    await withMutationLock(ref, async () => {
      lockDuringFn = ref.current;
    });

    expect(lockDuringFn).toBe(true);
    expect(ref.current).toBe(false);
  });

  it('returns executed: false without calling fn when lock is already held', async () => {
    const ref = makeRef(true);
    const fn = vi.fn(async () => 'should not run');

    const result = await withMutationLock(ref, fn);

    expect(result).toEqual({ executed: false });
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns executed: false for concurrent re-entrant call', async () => {
    const ref = makeRef(false);
    let innerResult: { executed: boolean } | undefined;

    await withMutationLock(ref, async () => {
      // Attempt a second lock while the first is held
      innerResult = await withMutationLock(ref, async () => 'should not run');
    });

    expect(innerResult).toEqual({ executed: false });
    expect(ref.current).toBe(false); // lock released after outer completes
  });

  it('releases the lock even when fn throws', async () => {
    const ref = makeRef(false);

    await expect(
      withMutationLock(ref, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(ref.current).toBe(false);
  });
});

describe('requireJwt', () => {
  it('returns JWT when getJwt returns a string', () => {
    const getJwt = () => 'my-jwt-token';
    expect(requireJwt(getJwt)).toBe('my-jwt-token');
  });

  it('throws when getJwt returns null', () => {
    const getJwt = () => null;
    expect(() => requireJwt(getJwt)).toThrow('Authentication required');
  });
});
