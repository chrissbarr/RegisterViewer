import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useCloudSyncEngine, deriveSyncStatus, type UseCloudSyncEngineDeps } from './use-cloud-sync-engine';
import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';

vi.mock('../constants', () => ({
  CLOUD_SYNC_DEBOUNCE_MS: 100, // fast for tests
}));

// ── Helpers ──────────────────────────────────────────────────────────

function makeDataDeps(overrides: Record<string, unknown> = {}) {
  return {
    registers: overrides.registers ?? [{ id: 'r1' }],
    registerValues: overrides.registerValues ?? { r1: '0x0' },
    project: overrides.project ?? { title: 'Test' },
    addressUnitBits: overrides.addressUnitBits ?? 8,
  };
}

function makeInternal(overrides: Partial<InternalCloudSyncState> = {}): InternalCloudSyncState {
  return {
    ...initialInternalState,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<UseCloudSyncEngineDeps> = {}): UseCloudSyncEngineDeps {
  return {
    dataDeps: overrides.dataDeps ?? makeDataDeps(),
    internal: overrides.internal ?? makeInternal(),
    setInternal: overrides.setInternal ?? vi.fn(),
    canAutoSync: overrides.canAutoSync ?? false,
    getJwt: overrides.getJwt ?? vi.fn(() => 'mock-jwt'),
    saveToCloud: overrides.saveToCloud ?? vi.fn(() => Promise.resolve(true)),
  };
}

// ── deriveSyncStatus (pure function) ─────────────────────────────────

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
    'deriveSyncStatus(%s, %s, %s) -> %s',
    (canAutoSync, isDirty, asyncOverride, expected) => {
      expect(deriveSyncStatus(canAutoSync, isDirty, asyncOverride)).toBe(expected);
    },
  );
});

// ── Dirty tracking ──────────────────────────────────────────────────

describe('useCloudSyncEngine - dirty tracking', () => {
  let setInternal: ReturnType<typeof vi.fn<(updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void>>;

  beforeEach(() => {
    setInternal = vi.fn<(updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void>();
  });

  // ── Initial state ────────────────────────────────────────────────

  describe('initial state', () => {
    it('initializes isDirty as false when there is no cloudId', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({ setInternal })),
      );
      expect(result.current.isDirty).toBe(false);
    });

    it('initializes isDirty as false when cloudId exists and lastSavedVersion matches', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({
          internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }),
          setInternal,
        })),
      );
      expect(result.current.isDirty).toBe(false);
    });

    it('returns ref objects for dataVersion, needsVersionSync, and mutationLock', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({ setInternal })),
      );
      expect(result.current.dataVersionRef).toHaveProperty('current');
      expect(result.current.needsVersionSyncRef).toHaveProperty('current');
      expect(result.current.mutationLockRef).toHaveProperty('current');
    });
  });

  // ── Dirty detection on data changes ──────────────────────────────

  describe('dirty detection on data changes', () => {
    it('becomes dirty when data deps change and cloud project exists', () => {
      const deps = makeDeps({
        dataDeps: makeDataDeps(),
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.isDirty).toBe(false);

      rerender({
        ...deps,
        dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }),
      });
      expect(result.current.isDirty).toBe(true);
    });

    it('becomes dirty when registerValues change', () => {
      const deps = makeDeps({
        dataDeps: makeDataDeps(),
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      rerender({
        ...deps,
        dataDeps: makeDataDeps({ registerValues: { r1: '0xFF' } }),
      });
      expect(result.current.isDirty).toBe(true);
    });

    it('becomes dirty when project field changes', () => {
      const dataDeps = makeDataDeps({ project: { name: 'A' } });
      const deps = makeDeps({
        dataDeps,
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.isDirty).toBe(false);
      rerender({
        ...deps,
        dataDeps: makeDataDeps({ project: { name: 'B' } }),
      });
      expect(result.current.isDirty).toBe(true);
    });

    it('becomes dirty when addressUnitBits changes', () => {
      const dataDeps = makeDataDeps({ addressUnitBits: 8 });
      const deps = makeDeps({
        dataDeps,
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.isDirty).toBe(false);
      rerender({
        ...deps,
        dataDeps: makeDataDeps({ addressUnitBits: 16 }),
      });
      expect(result.current.isDirty).toBe(true);
    });

    it('stays not dirty when cloudId is null even if versions differ', () => {
      const deps = makeDeps({
        dataDeps: makeDataDeps(),
        internal: makeInternal({ cloudId: null, lastSavedVersion: 0 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      rerender({
        ...deps,
        dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }),
      });
      expect(result.current.isDirty).toBe(false);
    });

    it('stays not dirty when lastSavedVersion is negative', () => {
      const deps = makeDeps({
        dataDeps: makeDataDeps(),
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: -1 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      rerender({
        ...deps,
        dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }),
      });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // ── Becomes clean when saved ─────────────────────────────────────

  describe('becomes clean when saved', () => {
    it('becomes not dirty when lastSavedVersion matches dataVersion', () => {
      const dataDeps = makeDataDeps();
      const deps = makeDeps({
        dataDeps,
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      const currentVersion = result.current.dataVersionRef.current;
      rerender({
        ...deps,
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: currentVersion }),
      });
      expect(result.current.isDirty).toBe(false);
    });

    it('transitions dirty -> clean when lastSavedVersion catches up after data change', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      // Trigger dirty
      const newDataDeps = makeDataDeps({ registers: [{ id: 'r2' }] });
      rerender({ ...deps, dataDeps: newDataDeps });
      expect(result.current.isDirty).toBe(true);
      expect(result.current.dataVersionRef.current).toBe(2);

      // Catch up lastSavedVersion -> clean
      rerender({
        ...deps,
        dataDeps: newDataDeps,
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 2 }),
      });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // ── needsVersionSyncRef ──────────────────────────────────────────

  describe('needsVersionSyncRef', () => {
    it('initializes needsVersionSyncRef to false', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({ setInternal })),
      );
      expect(result.current.needsVersionSyncRef.current).toBe(false);
    });

    it('calls setInternal with captured version when needsVersionSyncRef is true', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      act(() => {
        result.current.needsVersionSyncRef.current = true;
      });

      // Trigger a data change to fire the effect
      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r3' }] }) });

      expect(setInternal).toHaveBeenCalled();
      const updater = setInternal.mock.calls[setInternal.mock.calls.length - 1][0];
      const updated = updater(internal);
      expect(updated.lastSavedVersion).toBe(result.current.dataVersionRef.current);
    });

    it('clears needsVersionSyncRef after syncing', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      act(() => {
        result.current.needsVersionSyncRef.current = true;
      });

      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r4' }] }) });
      expect(result.current.needsVersionSyncRef.current).toBe(false);
    });

    it('captures current version without bump when data deps did not change', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      const versionBeforeSync = result.current.dataVersionRef.current;

      act(() => {
        result.current.needsVersionSyncRef.current = true;
      });

      // Rerender with same data deps but changed internal to retrigger effect
      rerender({
        ...deps,
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 }),
      });

      expect(setInternal).toHaveBeenCalled();
      const updater = setInternal.mock.calls[setInternal.mock.calls.length - 1][0];
      const updated = updater(makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 }));
      // Version should not have bumped since data deps are same references
      expect(updated.lastSavedVersion).toBe(versionBeforeSync);
    });

    it('early-returns before isDirty update when needsVersionSyncRef triggers', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.isDirty).toBe(false);

      act(() => {
        result.current.needsVersionSyncRef.current = true;
      });

      // Data change would normally make it dirty, but the sync path returns early
      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r9' }] }) });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // ── mutationLockRef ──────────────────────────────────────────────

  describe('mutationLockRef', () => {
    it('is initialized to false', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({ setInternal })),
      );
      expect(result.current.mutationLockRef.current).toBe(false);
    });

    it('can be set externally and retains its value across rerenders', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal();
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      act(() => {
        result.current.mutationLockRef.current = true;
      });

      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r5' }] }) });
      expect(result.current.mutationLockRef.current).toBe(true);
    });
  });

  // ── dataVersionRef increments ────────────────────────────────────

  describe('dataVersionRef increments', () => {
    it('starts at 1 after initial render (sentinel -> real data)', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({ setInternal })),
      );
      expect(result.current.dataVersionRef.current).toBe(1);
    });

    it('increments on each data dep change', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal();
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.dataVersionRef.current).toBe(1);

      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });
      expect(result.current.dataVersionRef.current).toBe(2);

      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }], registerValues: { r2: '0xFF' } }) });
      expect(result.current.dataVersionRef.current).toBe(3);

      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }], registerValues: { r2: '0xFF' }, project: { name: 'New' } }) });
      expect(result.current.dataVersionRef.current).toBe(4);
    });

    it('does not increment when data deps are the same reference', () => {
      const dataDeps = makeDataDeps();
      const deps = makeDeps({ dataDeps, internal: makeInternal(), setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.dataVersionRef.current).toBe(1);

      // Rerender with same deps reference but different internal
      rerender({ ...deps, internal: makeInternal({ cloudId: 'c1', lastSavedVersion: 1 }) });
      expect(result.current.dataVersionRef.current).toBe(1);
    });

    it('does not increment when rerendered with identical-but-new internal only', () => {
      const dataDeps = makeDataDeps();
      const deps = makeDeps({
        dataDeps,
        internal: makeInternal({ cloudId: 'c1', lastSavedVersion: 1 }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.dataVersionRef.current).toBe(1);

      // Same deps object, new internal object with different values
      rerender({ ...deps, internal: makeInternal({ cloudId: 'c1', lastSavedVersion: 2 }) });
      expect(result.current.dataVersionRef.current).toBe(1);
    });
  });
});

// ── Auto-sync ───────────────────────────────────────────────────────

describe('useCloudSyncEngine - auto-sync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns local-only when canAutoSync is false', () => {
    const { result } = renderHook(() =>
      useCloudSyncEngine(makeDeps({ canAutoSync: false })),
    );
    expect(result.current.syncStatus).toBe('local-only');
  });

  it('returns saved when not dirty and canAutoSync', () => {
    // Not dirty because no cloudId — canAutoSync true but no dirty trigger
    const { result } = renderHook(() =>
      useCloudSyncEngine(makeDeps({ canAutoSync: true })),
    );
    expect(result.current.syncStatus).toBe('saved');
  });

  it('schedules save after debounce when dirty', async () => {
    const saveToCloud = vi.fn(() => Promise.resolve(true as const));
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });
    const dataDeps = makeDataDeps();

    // First render sets version to 1, lastSavedVersion is 0 -> dirty
    const deps = makeDeps({
      dataDeps,
      internal,
      canAutoSync: true,
      saveToCloud,
    });

    const { result, rerender } = renderHook(
      (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
      { initialProps: deps },
    );

    // Make dirty by changing data (version bumps to 2, lastSavedVersion stays 0)
    rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });
    expect(result.current.isDirty).toBe(true);

    // Save should not have been called yet
    expect(saveToCloud).not.toHaveBeenCalled();

    // Advance past debounce
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(saveToCloud).toHaveBeenCalledTimes(1);
  });

  it('sets offline status when save rejects', async () => {
    const saveToCloud = vi.fn(() => Promise.reject(new Error('network error')));
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });
    const dataDeps = makeDataDeps();

    const deps = makeDeps({
      dataDeps,
      internal,
      canAutoSync: true,
      saveToCloud,
    });

    const { result, rerender } = renderHook(
      (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
      { initialProps: deps },
    );

    // Make dirty
    rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });

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
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });
    const dataDeps = makeDataDeps();

    const deps = makeDeps({
      dataDeps,
      internal,
      canAutoSync: true,
      saveToCloud,
    });

    const { rerender } = renderHook(
      (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
      { initialProps: deps },
    );

    // Make dirty
    rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });

    // First attempt -- returns false (lock held)
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
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });
    const dataDeps = makeDataDeps();

    const deps = makeDeps({
      dataDeps,
      internal,
      canAutoSync: true,
      saveToCloud,
      getJwt: vi.fn(() => null),
    });

    const { rerender } = renderHook(
      (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
      { initialProps: deps },
    );

    // Make dirty
    rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(saveToCloud).not.toHaveBeenCalled();
  });

  it('resets asyncOverride when canAutoSync toggles off', async () => {
    const saveToCloud = vi.fn<() => Promise<boolean>>(() => Promise.reject(new Error('network error')));
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });
    const dataDeps = makeDataDeps();

    const deps = makeDeps({
      dataDeps,
      internal,
      canAutoSync: true,
      saveToCloud,
    });

    const { result, rerender } = renderHook(
      (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
      { initialProps: deps },
    );

    // Make dirty
    const dirtyDataDeps = makeDataDeps({ registers: [{ id: 'r2' }] });
    rerender({ ...deps, dataDeps: dirtyDataDeps });

    // Trigger offline state
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(result.current.syncStatus).toBe('offline');

    // Toggle canAutoSync off -- should reset asyncOverride
    await act(async () => {
      rerender({ ...deps, dataDeps: dirtyDataDeps, canAutoSync: false });
    });
    expect(result.current.syncStatus).toBe('local-only');

    // Toggle back on -- should be 'saved' (asyncOverride was cleared), not 'offline'
    saveToCloud.mockResolvedValue(true);
    await act(async () => {
      rerender({
        ...deps,
        dataDeps: dirtyDataDeps,
        internal: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 2 }),
        canAutoSync: true,
      });
    });
    expect(result.current.syncStatus).toBe('saved');
  });

  describe('flushCloudSync', () => {
    it('calls saveToCloud immediately when dirty', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const internal = makeInternal({
        cloudId: 'cloud-abc',
        isOwner: true,
        lastSavedVersion: 0,
      });

      const deps = makeDeps({
        internal,
        canAutoSync: true,
        saveToCloud,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      // Make dirty by changing data
      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });

      await act(async () => {
        await result.current.flushCloudSync();
      });

      expect(saveToCloud).toHaveBeenCalledTimes(1);
    });

    it('skips when versions match', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const internal = makeInternal({
        cloudId: 'cloud-abc',
        isOwner: true,
        lastSavedVersion: 1, // will match dataVersionRef (1 after initial render)
      });

      const deps = makeDeps({
        internal,
        canAutoSync: true,
        saveToCloud,
      });

      const { result } = renderHook(() => useCloudSyncEngine(deps));

      await act(async () => {
        await result.current.flushCloudSync();
      });

      expect(saveToCloud).not.toHaveBeenCalled();
    });

    it('swallows errors thrown by saveToCloud (best-effort flush)', async () => {
      const saveToCloud = vi.fn().mockRejectedValue(new Error('Network error'));
      const internal = makeInternal({
        cloudId: 'cloud-abc',
        isOwner: true,
        lastSavedVersion: 0,
      });

      const deps = makeDeps({
        internal,
        saveToCloud,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      // Make dirty
      rerender({ ...deps, dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });

      // Should NOT throw -- flushCloudSync is best-effort
      await act(async () => {
        await result.current.flushCloudSync();
      });

      expect(saveToCloud).toHaveBeenCalledTimes(1);
    });

    it('skips when no cloudId', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const internal = makeInternal({ cloudId: null });

      const deps = makeDeps({ internal, saveToCloud });

      const { result } = renderHook(() => useCloudSyncEngine(deps));

      await act(async () => {
        await result.current.flushCloudSync();
      });

      expect(saveToCloud).not.toHaveBeenCalled();
    });

    it('skips when not owner', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve(true as const));
      const internal = makeInternal({
        cloudId: 'cloud-abc',
        isOwner: false,
        lastSavedVersion: 0,
      });

      const deps = makeDeps({ internal, saveToCloud });

      const { result } = renderHook(() => useCloudSyncEngine(deps));

      await act(async () => {
        await result.current.flushCloudSync();
      });

      expect(saveToCloud).not.toHaveBeenCalled();
    });
  });
});
