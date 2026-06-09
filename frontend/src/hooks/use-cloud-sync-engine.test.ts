import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { useCloudSyncEngine, deriveSyncStatus, type UseCloudSyncEngineDeps } from './use-cloud-sync-engine';
import { cleanBaseline, untrackedBaseline } from '../utils/cloud-sync-reducer';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDeps(overrides: Record<string, any> = {}): UseCloudSyncEngineDeps {
  return {
    dataDeps: overrides.dataDeps ?? makeDataDeps(),
    internal: overrides.internal ?? makeInternal(),
    setInternal: overrides.setInternal ?? vi.fn(),
    canAutoSync: overrides.canAutoSync ?? false,
    getJwt: overrides.getJwt ?? vi.fn(() => 'mock-jwt'),
    saveToCloud: overrides.saveToCloud ?? vi.fn(() => Promise.resolve('saved' as const)),
  };
}

/**
 * Render the engine with a LIVE reducer-backed `internal`: every `setInternal`
 * dispatch (functional updater) is applied to a mutable internal object and the
 * hook is rerendered. This lets the S9 `asyncTransient` overlay (and the S8
 * baseline-capture handshake) flow back into the rendered state so `syncStatus`
 * derivations observe the dispatched transient — replacing the former white-box
 * `asyncOverride` useState that the engine owned directly.
 */
function renderEngineWithLiveInternal(initial: InternalCloudSyncState, overrides: Record<string, unknown> = {}) {
  let internal = initial;
  let mounted = true;
  const setInternal = vi.fn((updater: unknown) => {
    internal = typeof updater === 'function'
      ? (updater as (prev: InternalCloudSyncState) => InternalCloudSyncState)(internal)
      : (updater as InternalCloudSyncState);
    rerenderInternal();
  });
  let rerenderInternal = () => {};

  const baseDeps = makeDeps({ ...overrides, internal, setInternal });
  const utils = renderHook(
    (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
    { initialProps: baseDeps },
  );

  // Keep `dataDeps`/other props stable across internal-driven rerenders; only
  // the live `internal` changes (mirrors how the provider re-renders the engine
  // when reducer state updates). After unmount, the microtask cleanup may still
  // dispatch SET_ASYNC_TRANSIENT(null) — drop it rather than touching a dead root.
  let currentProps: UseCloudSyncEngineDeps = baseDeps;
  rerenderInternal = () => {
    if (!mounted) return;
    currentProps = { ...currentProps, internal };
    try {
      utils.rerender(currentProps);
    } catch {
      // The microtask cleanup (SET_ASYNC_TRANSIENT(null)) can land after RTL's
      // auto-cleanup has unmounted the root ("Cannot update an unmounted root").
      // The dispatch is a no-op for an unmounted hook; swallow it.
      mounted = false;
    }
  };

  return {
    ...utils,
    setInternal,
    getInternal: () => internal,
    unmount: () => {
      mounted = false;
      utils.unmount();
    },
    rerenderProps: (next: Partial<UseCloudSyncEngineDeps>) => {
      // An explicit `internal` override adopts the new value as the live state;
      // otherwise the live (dispatch-driven) internal is preserved.
      if (next.internal) internal = next.internal;
      currentProps = { ...currentProps, ...next, internal };
      utils.rerender(currentProps);
    },
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
    [true, true, null, 'saved'], // BP-4: isDirty during debounce window shows 'saved' (intentional UX choice)
  ] as const)(
    'deriveSyncStatus(%s, %s, %s) -> %s',
    (canAutoSync, isDirty, asyncOverride, expected) => {
      expect(deriveSyncStatus(canAutoSync, isDirty, asyncOverride)).toBe(expected);
    },
  );
});

// ── Dirty tracking ──────────────────────────────────────────────────

describe('useCloudSyncEngine - dirty tracking', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let setInternal: Mock<any>;

  beforeEach(() => {
    setInternal = vi.fn();
  });

  // ── Initial state ────────────────────────────────────────────────

  describe('initial state', () => {
    it('initializes isDirty as false when there is no cloudId', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({ setInternal })),
      );
      expect(result.current.isDirty).toBe(false);
    });

    it('initializes isDirty as false when cloudId exists and the clean baseline matches', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({
          internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(1) }),
          setInternal,
        })),
      );
      expect(result.current.isDirty).toBe(false);
    });

    it('returns ref objects for dataVersion and mutationLock', () => {
      const { result } = renderHook(() =>
        useCloudSyncEngine(makeDeps({ setInternal })),
      );
      expect(result.current.dataVersionRef).toHaveProperty('current');
      expect(result.current.mutationLockRef).toHaveProperty('current');
    });
  });

  // ── Dirty detection on data changes ──────────────────────────────

  describe('dirty detection on data changes', () => {
    it('becomes dirty when data deps change and cloud project exists', () => {
      const deps = makeDeps({
        dataDeps: makeDataDeps(),
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(1) }),
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
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(1) }),
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
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(1) }),
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
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(1) }),
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
        internal: makeInternal({ cloudId: null, baseline: cleanBaseline(0) }),
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

    it('stays not dirty when the baseline is untracked', () => {
      const deps = makeDeps({
        dataDeps: makeDataDeps(),
        internal: makeInternal({ cloudId: 'cloud-1', baseline: untrackedBaseline() }),
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
    it('becomes not dirty when the clean baseline matches dataVersion', () => {
      const dataDeps = makeDataDeps();
      const deps = makeDeps({
        dataDeps,
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(1) }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      const currentVersion = result.current.dataVersionRef.current;
      rerender({
        ...deps,
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(currentVersion) }),
      });
      expect(result.current.isDirty).toBe(false);
    });

    it('transitions dirty -> clean when the baseline catches up after data change', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(1) });
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

      // Catch up the clean baseline -> clean
      rerender({
        ...deps,
        dataDeps: newDataDeps,
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(2) }),
      });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // ── baseline-capture handshake (S8, replaces needsVersionSyncRef) ─

  describe('baseline-capture handshake', () => {
    // The engine no longer owns a `needsVersionSyncRef`; the "awaiting capture"
    // marker now lives on reducer state as `baseline:{untracked}` (S14a) gated by
    // `cloudId !== null`, and the engine dispatches CAPTURE_BASELINE (via
    // setInternal) on its next effect tick. These tests re-express the SAME
    // capture behavior against the baseline union.

    it('dispatches CAPTURE_BASELINE with the post-increment version when awaiting and data changed', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', baseline: untrackedBaseline() });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      // Trigger a data change to fire the effect (capture is post-increment).
      rerender({ ...deps, internal, dataDeps: makeDataDeps({ registers: [{ id: 'r3' }] }) });

      expect(setInternal).toHaveBeenCalled();
      const updater = setInternal.mock.calls[setInternal.mock.calls.length - 1][0] as (prev: InternalCloudSyncState) => InternalCloudSyncState;
      const updated = updater(internal);
      // Captured at the post-increment generation (the off-by-one guard) as a
      // clean baseline (clears the untracked awaiting marker).
      expect(updated.baseline).toEqual(cleanBaseline(result.current.dataVersionRef.current));
    });

    it('captures current version without bump when data deps did not change', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', baseline: untrackedBaseline() });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      const versionBeforeSync = result.current.dataVersionRef.current;

      // Rerender with same data deps but changed internal (still awaiting) to retrigger effect.
      rerender({
        ...deps,
        internal: makeInternal({ cloudId: 'cloud-1', baseline: untrackedBaseline() }),
      });

      expect(setInternal).toHaveBeenCalled();
      const updater = setInternal.mock.calls[setInternal.mock.calls.length - 1][0] as (prev: InternalCloudSyncState) => InternalCloudSyncState;
      const updated = updater(makeInternal({ cloudId: 'cloud-1', baseline: untrackedBaseline() }));
      // Version should not have bumped since data deps are same references
      expect(updated.baseline).toEqual(cleanBaseline(versionBeforeSync));
    });

    it('early-returns before isDirty update when awaiting baseline capture', () => {
      const dataDeps = makeDataDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', baseline: untrackedBaseline() });
      const deps = makeDeps({ dataDeps, internal, setInternal });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.isDirty).toBe(false);

      // Data change would normally make it dirty, but the capture path returns early.
      rerender({ ...deps, internal, dataDeps: makeDataDeps({ registers: [{ id: 'r9' }] }) });
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
      rerender({ ...deps, internal: makeInternal({ cloudId: 'c1', baseline: cleanBaseline(1) }) });
      expect(result.current.dataVersionRef.current).toBe(1);
    });

    it('does not increment when rerendered with identical-but-new internal only', () => {
      const dataDeps = makeDataDeps();
      const deps = makeDeps({
        dataDeps,
        internal: makeInternal({ cloudId: 'c1', baseline: cleanBaseline(1) }),
        setInternal,
      });

      const { result, rerender } = renderHook(
        (props: UseCloudSyncEngineDeps) => useCloudSyncEngine(props),
        { initialProps: deps },
      );

      expect(result.current.dataVersionRef.current).toBe(1);

      // Same deps object, new internal object with different values
      rerender({ ...deps, internal: makeInternal({ cloudId: 'c1', baseline: cleanBaseline(2) }) });
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
    const saveToCloud = vi.fn(() => Promise.resolve('saved' as const));
    const internal = makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(0) });
    const dataDeps = makeDataDeps();

    // First render sets version to 1, clean baseline is 0 -> dirty
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

    // Make dirty by changing data (version bumps to 2, clean baseline stays 0)
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

  it('sets offline status (asyncTransient) when save rejects', async () => {
    const saveToCloud = vi.fn(() => Promise.reject(new Error('network error')));
    // Live internal so the dispatched SET_ASYNC_TRANSIENT('offline') flows back
    // into deriveSyncStatus's third input (the reducer field, not a useState).
    const { result, rerenderProps, getInternal } = renderEngineWithLiveInternal(
      makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(0) }),
      { dataDeps: makeDataDeps(), canAutoSync: true, saveToCloud },
    );

    // Make dirty
    rerenderProps({ dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });

    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });

    expect(getInternal().asyncTransient).toBe('offline');
    expect(result.current.syncStatus).toBe('offline');
  });

  it('reschedules when mutation lock was held (saveToCloud returns lock-held)', async () => {
    let callCount = 0;
    const saveToCloud = vi.fn(() => {
      callCount++;
      return Promise.resolve(callCount === 1 ? 'lock-held' as const : 'saved' as const);
    });
    const internal = makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(0) });
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

  it('reschedules lock-held with backoff but stops at the retry cap', async () => {
    const saveToCloud = vi.fn(async () => 'lock-held' as const);
    // Live internal so the terminal SET_ASYNC_TRANSIENT('offline') is observable.
    const { result, rerenderProps } = renderEngineWithLiveInternal(
      makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(0) }),
      { dataDeps: makeDataDeps(), canAutoSync: true, saveToCloud },
    );

    // Make dirty
    rerenderProps({ dataDeps: makeDataDeps({ registers: [{ id: 'r2' }] }) });

    // Advance well past the cap (5 attempts * growing backoff).
    for (let i = 0; i < 10; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    }
    // With 100ms debounce, all 5 attempts land deterministically in the first 60s advance.
    expect(saveToCloud).toHaveBeenCalledTimes(5);
    // After exhaustion the hook must report offline (not saved or syncing).
    expect(result.current.syncStatus).toBe('offline');
  });

  it('does not reschedule after a local-persist-failed outcome', async () => {
    const saveToCloud = vi.fn(async () => 'local-persist-failed' as const);
    const internal = makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(0) });
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

    await act(async () => { await vi.advanceTimersByTimeAsync(100); }); // first fire
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); }); // no further retry
    expect(saveToCloud).toHaveBeenCalledTimes(1);
  });

  it('skips save when no JWT available', async () => {
    const saveToCloud = vi.fn(() => Promise.resolve('saved' as const));
    const internal = makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(0) });
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

  it('resets the asyncTransient via the microtask cleanup when canAutoSync toggles off', async () => {
    const saveToCloud = vi.fn<() => Promise<'saved'>>(() => Promise.reject(new Error('network error')));
    const dirtyDataDeps = makeDataDeps({ registers: [{ id: 'r2' }] });
    // Live internal so the dispatched SET_ASYNC_TRANSIENT (set + microtask clear)
    // round-trips through the reducer field that deriveSyncStatus reads.
    const { result, rerenderProps, getInternal } = renderEngineWithLiveInternal(
      makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(0) }),
      { dataDeps: makeDataDeps(), canAutoSync: true, saveToCloud },
    );

    // Make dirty
    rerenderProps({ dataDeps: dirtyDataDeps });

    // Trigger offline state
    await act(async () => {
      vi.advanceTimersByTime(150);
      await Promise.resolve();
    });
    expect(result.current.syncStatus).toBe('offline');
    expect(getInternal().asyncTransient).toBe('offline');

    // Toggle canAutoSync off -- the effect cleanup dispatches the microtask clear.
    await act(async () => {
      rerenderProps({ canAutoSync: false });
      await Promise.resolve(); // flush the microtask cleanup
    });
    expect(result.current.syncStatus).toBe('local-only');
    // The transient was cleared in the same microtask the effect cleanup scheduled.
    expect(getInternal().asyncTransient).toBeNull();

    // Toggle back on -- should be 'saved' (transient was cleared), not 'offline'.
    saveToCloud.mockResolvedValue('saved');
    await act(async () => {
      rerenderProps({
        internal: makeInternal({ cloudId: 'cloud-1', baseline: cleanBaseline(2), asyncTransient: null }),
        canAutoSync: true,
      });
    });
    expect(result.current.syncStatus).toBe('saved');
  });

  describe('flushCloudSync', () => {
    it('calls saveToCloud immediately when dirty', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve('saved' as const));
      const internal = makeInternal({
        cloudId: 'cloud-abc',
        isOwner: true,
        baseline: cleanBaseline(0),
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
      const saveToCloud = vi.fn(() => Promise.resolve('saved' as const));
      const internal = makeInternal({
        cloudId: 'cloud-abc',
        isOwner: true,
        baseline: cleanBaseline(1), // will match dataVersionRef (1 after initial render)
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
        baseline: cleanBaseline(0),
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
      const saveToCloud = vi.fn(() => Promise.resolve('saved' as const));
      const internal = makeInternal({ cloudId: null });

      const deps = makeDeps({ internal, saveToCloud });

      const { result } = renderHook(() => useCloudSyncEngine(deps));

      await act(async () => {
        await result.current.flushCloudSync();
      });

      expect(saveToCloud).not.toHaveBeenCalled();
    });

    it('skips when not owner', async () => {
      const saveToCloud = vi.fn(() => Promise.resolve('saved' as const));
      const internal = makeInternal({
        cloudId: 'cloud-abc',
        isOwner: false,
        baseline: cleanBaseline(0),
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
