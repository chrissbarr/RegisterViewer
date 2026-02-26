import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useDirtyTracking } from './use-dirty-tracking';

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    registers: overrides.registers ?? [{ id: 'r1' }],
    registerValues: overrides.registerValues ?? { r1: '0x0' },
    project: overrides.project ?? { title: 'Test' },
    addressUnitBits: overrides.addressUnitBits ?? 8,
  };
}

function makeInternal(overrides: Partial<{ cloudId: string | null; lastSavedVersion: number }> = {}) {
  return {
    cloudId: overrides.cloudId ?? null,
    lastSavedVersion: overrides.lastSavedVersion ?? -1,
  };
}

describe('useDirtyTracking', () => {
  it('initializes isDirty as false', () => {
    const setInternal = vi.fn();
    const { result } = renderHook(() =>
      useDirtyTracking(makeDeps(), makeInternal(), setInternal),
    );
    expect(result.current.isDirty).toBe(false);
  });

  it('returns ref objects for dataVersion, needsVersionSync, and mutationLock', () => {
    const setInternal = vi.fn();
    const { result } = renderHook(() =>
      useDirtyTracking(makeDeps(), makeInternal(), setInternal),
    );
    expect(result.current.dataVersionRef).toHaveProperty('current');
    expect(result.current.needsVersionSyncRef).toHaveProperty('current');
    expect(result.current.mutationLockRef).toHaveProperty('current');
  });

  it('stays not dirty when cloudId is null', () => {
    const setInternal = vi.fn();
    const deps = makeDeps();
    const internal = makeInternal({ cloudId: null, lastSavedVersion: 0 });

    const { result, rerender } = renderHook(
      ({ d, i }) => useDirtyTracking(d, i, setInternal),
      { initialProps: { d: deps, i: internal } },
    );

    // Change data to trigger the effect
    rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
    expect(result.current.isDirty).toBe(false);
  });

  it('stays not dirty when lastSavedVersion is negative', () => {
    const setInternal = vi.fn();
    const deps = makeDeps();
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: -1 });

    const { result, rerender } = renderHook(
      ({ d, i }) => useDirtyTracking(d, i, setInternal),
      { initialProps: { d: deps, i: internal } },
    );

    rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
    expect(result.current.isDirty).toBe(false);
  });

  it('becomes dirty when data changes and cloud project exists', () => {
    const setInternal = vi.fn();
    const deps = makeDeps();
    // lastSavedVersion = 1, but after initial render + data change, dataVersionRef will be > 1
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

    const { result, rerender } = renderHook(
      ({ d, i }) => useDirtyTracking(d, i, setInternal),
      { initialProps: { d: deps, i: internal } },
    );

    // Change data deps to trigger another version increment
    rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
    expect(result.current.isDirty).toBe(true);
  });

  it('increments dataVersionRef on each data change', () => {
    const setInternal = vi.fn();
    const deps = makeDeps();
    const internal = makeInternal();

    const { result, rerender } = renderHook(
      ({ d, i }) => useDirtyTracking(d, i, setInternal),
      { initialProps: { d: deps, i: internal } },
    );

    const v1 = result.current.dataVersionRef.current;
    rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
    const v2 = result.current.dataVersionRef.current;

    expect(v2).toBeGreaterThan(v1);
  });

  it('syncs version to state when needsVersionSyncRef is true', () => {
    const setInternal = vi.fn();
    const deps = makeDeps();
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });

    const { result, rerender } = renderHook(
      ({ d, i }) => useDirtyTracking(d, i, setInternal),
      { initialProps: { d: deps, i: internal } },
    );

    // Set the sync flag
    act(() => {
      result.current.needsVersionSyncRef.current = true;
    });

    // Trigger a data change to fire the effect
    rerender({ d: makeDeps({ registers: [{ id: 'r3' }] }), i: internal });

    expect(setInternal).toHaveBeenCalled();
    const updater = setInternal.mock.calls[setInternal.mock.calls.length - 1][0];
    const updated = updater(internal);
    expect(updated.lastSavedVersion).toBe(result.current.dataVersionRef.current);
  });

  it('clears needsVersionSyncRef after syncing', () => {
    const setInternal = vi.fn();
    const deps = makeDeps();
    const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });

    const { result, rerender } = renderHook(
      ({ d, i }) => useDirtyTracking(d, i, setInternal),
      { initialProps: { d: deps, i: internal } },
    );

    act(() => {
      result.current.needsVersionSyncRef.current = true;
    });

    rerender({ d: makeDeps({ registers: [{ id: 'r4' }] }), i: internal });
    expect(result.current.needsVersionSyncRef.current).toBe(false);
  });

  it('becomes not dirty when lastSavedVersion matches dataVersion', () => {
    const setInternal = vi.fn();
    const deps = makeDeps();

    const { result, rerender } = renderHook(
      ({ d, i }) => useDirtyTracking(d, i, setInternal),
      { initialProps: { d: deps, i: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }) } },
    );

    // Match the current dataVersion to lastSavedVersion
    const currentVersion = result.current.dataVersionRef.current;
    rerender({ d: deps, i: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: currentVersion }) });
    expect(result.current.isDirty).toBe(false);
  });
});
