import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useAutoSync, deriveSyncStatus } from './use-auto-sync';

vi.mock('../constants', () => ({
  CLOUD_SYNC_DEBOUNCE_MS: 100, // fast for tests
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeInternalRef(overrides: Partial<Parameters<typeof useAutoSync>[0]['internalRef']['current']> = {}) {
  return {
    current: {
      cloudId: 'cloud-abc',
      isOwner: true,
      storage: 'cloud' as const,
      lastSavedVersion: 1,
      error: null,
      ...overrides,
    },
  };
}

function makeDeps(overrides: Partial<Parameters<typeof useAutoSync>[0]> = {}) {
  return {
    isDirty: false,
    internalRef: makeInternalRef(),
    dataVersionRef: { current: 2 },
    canAutoSync: true,
    getJwt: vi.fn(() => 'mock-jwt'),
    saveToCloud: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useAutoSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns local-only when canAutoSync is false', () => {
    const { result } = renderHook(() => useAutoSync(makeDeps({ canAutoSync: false })));
    expect(result.current.syncStatus).toBe('local-only');
  });

  it('returns saved when not dirty and canAutoSync', () => {
    const { result } = renderHook(() => useAutoSync(makeDeps({ isDirty: false, canAutoSync: true })));
    expect(result.current.syncStatus).toBe('saved');
  });

  it('schedules save after debounce when dirty', async () => {
    const saveToCloud = vi.fn(() => Promise.resolve(true as const));
    const deps = makeDeps({ isDirty: true, canAutoSync: true, saveToCloud });

    renderHook(() => useAutoSync(deps));

    // Save should not have been called yet
    expect(saveToCloud).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(150);
      // Let microtasks flush
      await Promise.resolve();
    });

    expect(saveToCloud).toHaveBeenCalledTimes(1);
  });

  it('sets offline status when save rejects', async () => {
    const saveToCloud = vi.fn(() => Promise.reject(new Error('network error')));
    const deps = makeDeps({ isDirty: true, canAutoSync: true, saveToCloud });

    const { result } = renderHook(() => useAutoSync(deps));

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(result.current.syncStatus).toBe('offline');
  });

  it('reschedules when mutation lock was held (saveToCloud returns false)', async () => {
    let callCount = 0;
    const saveToCloud = vi.fn(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? false : true);
    });
    const deps = makeDeps({ isDirty: true, canAutoSync: true, saveToCloud });

    renderHook(() => useAutoSync(deps));

    // First attempt — returns false (lock held)
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(saveToCloud).toHaveBeenCalledTimes(1);

    // Second attempt after reschedule
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(saveToCloud).toHaveBeenCalledTimes(2);
  });

  it('skips save when no JWT available', async () => {
    const saveToCloud = vi.fn(() => Promise.resolve(true as const));
    const deps = makeDeps({
      isDirty: true,
      canAutoSync: true,
      saveToCloud,
      getJwt: vi.fn(() => null),
    });

    renderHook(() => useAutoSync(deps));

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(saveToCloud).not.toHaveBeenCalled();
  });

  it('resets asyncOverride when canAutoSync toggles off', async () => {
    const saveToCloud = vi.fn<() => Promise<boolean>>(() => Promise.reject(new Error('network error')));
    const deps = makeDeps({ isDirty: true, canAutoSync: true, saveToCloud });

    const { result, rerender } = renderHook(
      (props: Partial<Parameters<typeof useAutoSync>[0]>) => useAutoSync({ ...deps, ...props }),
      { initialProps: { isDirty: true, canAutoSync: true } },
    );

    // Trigger offline state
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(result.current.syncStatus).toBe('offline');

    // Toggle canAutoSync off — should reset asyncOverride
    await act(async () => {
      rerender({ isDirty: true, canAutoSync: false });
    });
    expect(result.current.syncStatus).toBe('local-only');

    // Toggle back on — should be 'saved' (asyncOverride was cleared), not 'offline'
    saveToCloud.mockResolvedValue(true);
    await act(async () => {
      rerender({ isDirty: false, canAutoSync: true });
    });
    expect(result.current.syncStatus).toBe('saved');
  });

  describe('flushSync', () => {
    it('calls saveToCloud immediately when dirty', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const internalRef = makeInternalRef({ lastSavedVersion: 1 });
      const deps = makeDeps({
        isDirty: false,
        canAutoSync: true,
        saveToCloud,
        internalRef,
        dataVersionRef: { current: 2 }, // different from lastSavedVersion → dirty
      });

      const { result } = renderHook(() => useAutoSync(deps));

      await act(async () => {
        await result.current.flushSync();
      });

      expect(saveToCloud).toHaveBeenCalledTimes(1);
    });

    it('skips when versions match', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const internalRef = makeInternalRef({ lastSavedVersion: 2 });
      const deps = makeDeps({
        saveToCloud,
        internalRef,
        dataVersionRef: { current: 2 }, // same → not dirty
      });

      const { result } = renderHook(() => useAutoSync(deps));

      await act(async () => {
        await result.current.flushSync();
      });

      expect(saveToCloud).not.toHaveBeenCalled();
    });

    it('swallows errors thrown by saveToCloud (best-effort flush)', async () => {
      const saveToCloud = vi.fn().mockRejectedValue(new Error('Network error'));
      const deps = makeDeps({
        saveToCloud,
        internalRef: makeInternalRef({ lastSavedVersion: 1 }),
        dataVersionRef: { current: 2 },
      });

      const { result } = renderHook(() => useAutoSync(deps));

      // Should NOT throw — flushSync is best-effort
      await act(async () => {
        await result.current.flushSync();
      });

      expect(saveToCloud).toHaveBeenCalledTimes(1);
    });

    it('swallows errors when stateOverride is provided (flush-before-evict)', async () => {
      const saveToCloud = vi.fn().mockRejectedValue(new Error('Network error'));
      const deps = makeDeps({
        saveToCloud,
        internalRef: makeInternalRef({ lastSavedVersion: 1 }),
        dataVersionRef: { current: 2 },
      });

      const { result } = renderHook(() => useAutoSync(deps));

      // Should NOT throw — flush-before-evict errors are swallowed
      await act(async () => {
        await result.current.flushSync({ registers: [], activeRegisterId: null, registerValues: {}, mapTableWidth: 32, mapShowGaps: true, mapSortDescending: false, addressUnitBits: 8 });
      });

      expect(saveToCloud).toHaveBeenCalledTimes(1);
    });

    it('skips when no cloudId', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const deps = makeDeps({
        saveToCloud,
        internalRef: makeInternalRef({ cloudId: null }),
        dataVersionRef: { current: 2 },
      });

      const { result } = renderHook(() => useAutoSync(deps));

      await act(async () => {
        await result.current.flushSync();
      });

      expect(saveToCloud).not.toHaveBeenCalled();
    });

    it('forwards stateOverride to saveToCloud', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const internalRef = makeInternalRef({ lastSavedVersion: 1 });
      const deps = makeDeps({
        isDirty: false,
        canAutoSync: true,
        saveToCloud,
        internalRef,
        dataVersionRef: { current: 5 },
      });

      const { result } = renderHook(() => useAutoSync(deps));

      const overrideState = {
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32 as const,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8 as const,
      };
      await act(async () => {
        await result.current.flushSync(overrideState);
      });

      expect(saveToCloud).toHaveBeenCalledWith(overrideState);
    });

    it('skips when not owner', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const deps = makeDeps({
        saveToCloud,
        internalRef: makeInternalRef({ isOwner: false }),
        dataVersionRef: { current: 2 },
      });

      const { result } = renderHook(() => useAutoSync(deps));

      await act(async () => {
        await result.current.flushSync();
      });

      expect(saveToCloud).not.toHaveBeenCalled();
    });
  });
});

describe('deriveSyncStatus', () => {
  it.each([
    [false, false, null, 'local-only'],
    [false, true, null, 'local-only'],
    [false, true, 'syncing' as const, 'local-only'],
    [false, false, 'offline' as const, 'local-only'],
    [true, false, null, 'saved'],
    [true, false, 'offline' as const, 'saved'],
    [true, true, 'syncing' as const, 'syncing'],
    [true, false, 'syncing' as const, 'syncing'],
    [true, true, 'offline' as const, 'offline'],
    [true, true, null, 'saved'],
  ] as const)(
    'deriveSyncStatus(%s, %s, %s) → %s',
    (canAutoSync, isDirty, asyncOverride, expected) => {
      expect(deriveSyncStatus(canAutoSync, isDirty, asyncOverride)).toBe(expected);
    },
  );
});
