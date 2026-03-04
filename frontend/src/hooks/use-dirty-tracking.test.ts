import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useDirtyTracking } from './use-dirty-tracking';

// ── Helpers ─────────────────────────────────────────────────────────

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

type InternalState = { cloudId: string | null; lastSavedVersion: number };

describe('useDirtyTracking', () => {
  let setInternal: ReturnType<typeof vi.fn<(updater: (prev: InternalState) => InternalState) => void>>;

  beforeEach(() => {
    setInternal = vi.fn<(updater: (prev: InternalState) => InternalState) => void>();
  });

  // ── 1. Initial state: not dirty ─────────────────────────────────

  describe('initial state', () => {
    it('initializes isDirty as false when there is no cloudId', () => {
      const { result } = renderHook(() =>
        useDirtyTracking(makeDeps(), makeInternal(), setInternal),
      );
      expect(result.current.isDirty).toBe(false);
    });

    it('initializes isDirty as false when cloudId exists and lastSavedVersion matches', () => {
      // After initial render the version bumps to 1 (Symbol sentinel → real data)
      const { result } = renderHook(() =>
        useDirtyTracking(
          makeDeps(),
          makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }),
          setInternal,
        ),
      );
      expect(result.current.isDirty).toBe(false);
    });

    it('returns ref objects for dataVersion, needsVersionSync, and mutationLock', () => {
      const { result } = renderHook(() =>
        useDirtyTracking(makeDeps(), makeInternal(), setInternal),
      );
      expect(result.current.dataVersionRef).toHaveProperty('current');
      expect(result.current.needsVersionSyncRef).toHaveProperty('current');
      expect(result.current.mutationLockRef).toHaveProperty('current');
    });
  });

  // ── 2. Becomes dirty when appState changes ──────────────────────

  describe('dirty detection on data changes', () => {
    it('becomes dirty when data deps change and cloud project exists', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      expect(result.current.isDirty).toBe(false);

      // Change data deps → version bumps to 2, lastSavedVersion is 1 → dirty
      rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
      expect(result.current.isDirty).toBe(true);
    });

    it('becomes dirty when registerValues change', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      rerender({ d: makeDeps({ registerValues: { r1: '0xFF' } }), i: internal });
      expect(result.current.isDirty).toBe(true);
    });

    it('becomes dirty when project field changes', () => {
      const deps = makeDeps({ project: { name: 'A' } });
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      expect(result.current.isDirty).toBe(false);
      rerender({ d: makeDeps({ project: { name: 'B' } }), i: internal });
      expect(result.current.isDirty).toBe(true);
    });

    it('becomes dirty when addressUnitBits changes', () => {
      const deps = makeDeps({ addressUnitBits: 8 });
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      expect(result.current.isDirty).toBe(false);
      rerender({ d: makeDeps({ addressUnitBits: 16 }), i: internal });
      expect(result.current.isDirty).toBe(true);
    });

    it('stays not dirty when cloudId is null even if versions differ', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: null, lastSavedVersion: 0 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
      expect(result.current.isDirty).toBe(false);
    });

    it('stays not dirty when lastSavedVersion is negative', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: -1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // ── 3. Becomes clean when lastSavedVersion catches up ───────────

  describe('becomes clean when saved', () => {
    it('becomes not dirty when lastSavedVersion matches dataVersion', () => {
      const deps = makeDeps();

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 }) } },
      );

      const currentVersion = result.current.dataVersionRef.current;
      rerender({ d: deps, i: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: currentVersion }) });
      expect(result.current.isDirty).toBe(false);
    });

    it('transitions dirty → clean when lastSavedVersion catches up after data change', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      // Trigger dirty
      const newDeps = makeDeps({ registers: [{ id: 'r2' }] });
      rerender({ d: newDeps, i: internal });
      expect(result.current.isDirty).toBe(true);
      expect(result.current.dataVersionRef.current).toBe(2);

      // Catch up lastSavedVersion → clean
      rerender({ d: newDeps, i: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 2 }) });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // ── 4. needsVersionSyncRef captures version after next bump ─────

  describe('needsVersionSyncRef', () => {
    it('initializes needsVersionSyncRef to false', () => {
      const { result } = renderHook(() =>
        useDirtyTracking(makeDeps(), makeInternal(), setInternal),
      );
      expect(result.current.needsVersionSyncRef.current).toBe(false);
    });

    it('calls setInternal with captured version when needsVersionSyncRef is true', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

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

    it('captures current version without bump when data deps did not change', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      const versionBeforeSync = result.current.dataVersionRef.current;

      act(() => {
        result.current.needsVersionSyncRef.current = true;
      });

      // Rerender with same data deps but changed internal to retrigger effect
      rerender({ d: deps, i: makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 0 }) });

      expect(setInternal).toHaveBeenCalled();
      const updater = setInternal.mock.calls[setInternal.mock.calls.length - 1][0];
      const updated = updater({ cloudId: 'cloud-1', lastSavedVersion: 0 });
      // Version should not have bumped since data deps are same references
      expect(updated.lastSavedVersion).toBe(versionBeforeSync);
    });

    it('early-returns before isDirty update when needsVersionSyncRef triggers', () => {
      const deps = makeDeps();
      const internal = makeInternal({ cloudId: 'cloud-1', lastSavedVersion: 1 });

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      expect(result.current.isDirty).toBe(false);

      act(() => {
        result.current.needsVersionSyncRef.current = true;
      });

      // Data change would normally make it dirty, but the sync path returns early
      rerender({ d: makeDeps({ registers: [{ id: 'r9' }] }), i: internal });
      expect(result.current.isDirty).toBe(false);
    });
  });

  // ── 5. mutationLockRef is initialized to false ──────────────────

  describe('mutationLockRef', () => {
    it('is initialized to false', () => {
      const { result } = renderHook(() =>
        useDirtyTracking(makeDeps(), makeInternal(), setInternal),
      );
      expect(result.current.mutationLockRef.current).toBe(false);
    });

    it('can be set externally and retains its value across rerenders', () => {
      const deps = makeDeps();
      const internal = makeInternal();

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      act(() => {
        result.current.mutationLockRef.current = true;
      });

      rerender({ d: makeDeps({ registers: [{ id: 'r5' }] }), i: internal });
      expect(result.current.mutationLockRef.current).toBe(true);
    });
  });

  // ── 6. dataVersionRef increments on each appState change ────────

  describe('dataVersionRef increments', () => {
    it('starts at 1 after initial render (sentinel → real data)', () => {
      const { result } = renderHook(() =>
        useDirtyTracking(makeDeps(), makeInternal(), setInternal),
      );
      expect(result.current.dataVersionRef.current).toBe(1);
    });

    it('increments on each data dep change', () => {
      const deps = makeDeps();
      const internal = makeInternal();

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      expect(result.current.dataVersionRef.current).toBe(1);

      rerender({ d: makeDeps({ registers: [{ id: 'r2' }] }), i: internal });
      expect(result.current.dataVersionRef.current).toBe(2);

      rerender({ d: makeDeps({ registers: [{ id: 'r2' }], registerValues: { r2: '0xFF' } }), i: internal });
      expect(result.current.dataVersionRef.current).toBe(3);

      rerender({ d: makeDeps({ registers: [{ id: 'r2' }], registerValues: { r2: '0xFF' }, project: { name: 'New' } }), i: internal });
      expect(result.current.dataVersionRef.current).toBe(4);
    });

    it('does not increment when data deps are the same reference', () => {
      const deps = makeDeps();
      const internal = makeInternal();

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: internal } },
      );

      expect(result.current.dataVersionRef.current).toBe(1);

      // Rerender with same deps reference but different internal
      rerender({ d: deps, i: makeInternal({ cloudId: 'c1', lastSavedVersion: 1 }) });
      expect(result.current.dataVersionRef.current).toBe(1);
    });

    it('does not increment when rerendered with identical-but-new internal only', () => {
      const deps = makeDeps();

      const { result, rerender } = renderHook(
        ({ d, i }) => useDirtyTracking(d, i, setInternal),
        { initialProps: { d: deps, i: makeInternal({ cloudId: 'c1', lastSavedVersion: 1 }) } },
      );

      expect(result.current.dataVersionRef.current).toBe(1);

      // Same deps object, new internal object with different values
      rerender({ d: deps, i: makeInternal({ cloudId: 'c1', lastSavedVersion: 2 }) });
      expect(result.current.dataVersionRef.current).toBe(1);
    });
  });
});
