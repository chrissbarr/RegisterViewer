import { describe, it, expect } from 'vitest';
import {
  cloudSyncReducer, cloudStateForEntry, isDirty, toInternalCloudSyncState,
  cleanBaseline, dirtyBaseline, untrackedBaseline,
  type CloudEntrySeed,
} from './cloud-sync-reducer';
import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';

describe('cloudSyncReducer', () => {
  it('applies a functional updater verbatim', () => {
    const next = cloudSyncReducer(initialInternalState, {
      type: '__RAW',
      updater: (prev) => ({ ...prev, cloudId: 'abc123' }),
    });
    expect(next.cloudId).toBe('abc123');
    // Untouched fields are preserved
    expect(next.storage).toBe(initialInternalState.storage);
  });

  it('applies a value updater (returns the supplied value verbatim)', () => {
    const replacement: InternalCloudSyncState = {
      ...initialInternalState,
      cloudId: 'xyz',
      isOwner: true,
      storage: 'cloud',
    };
    const next = cloudSyncReducer(initialInternalState, {
      type: '__RAW',
      updater: () => replacement,
    });
    expect(next).toBe(replacement);
  });

  it('returns a new state object (does not mutate prev) for object spreads', () => {
    const prev: InternalCloudSyncState = { ...initialInternalState };
    const next = cloudSyncReducer(prev, {
      type: '__RAW',
      updater: (p) => ({ ...p, error: 'boom' }),
    });
    expect(next).not.toBe(prev);
    expect(next.error).toBe('boom');
    expect(prev.error).toBeNull();
  });

  describe('named actions (S4)', () => {
    it('INIT_LOCAL resets to initial state with the given storage', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        error: 'stale',
      };
      const next = cloudSyncReducer(prev, { type: 'INIT_LOCAL', storage: 'local' });
      expect(next).toEqual({ ...initialInternalState, storage: 'local' });
    });

    it('INIT_LOCAL can seed cloud storage', () => {
      const next = cloudSyncReducer(initialInternalState, { type: 'INIT_LOCAL', storage: 'cloud' });
      expect(next.storage).toBe('cloud');
      expect(next.cloudId).toBeNull();
    });

    it('INIT_CLOUD returns the supplied seed verbatim', () => {
      const seed: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'cloud123',
        isOwner: true,
        storage: 'cloud',
        shareUrl: 'https://example/p/cloud123',
        baseline: cleanBaseline(4),
        lastCloudSavedAt: '2026-01-01T00:00:00Z',
        visibility: 'unlisted',
        serverVersion: 7,
      };
      const next = cloudSyncReducer(initialInternalState, { type: 'INIT_CLOUD', seed });
      expect(next).toBe(seed);
    });

    it('CLEAR_ERROR clears the error and preserves other fields', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        error: 'boom',
      };
      const next = cloudSyncReducer(prev, { type: 'CLEAR_ERROR' });
      expect(next.error).toBeNull();
      expect(next.cloudId).toBe('abc');
      expect(prev.error).toBe('boom');
    });

    it('RESET_WITH_ERROR returns initial state carrying only the error', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        serverVersion: 9,
      };
      const next = cloudSyncReducer(prev, { type: 'RESET_WITH_ERROR', error: 'deleted on server' });
      expect(next).toEqual({ ...initialInternalState, error: 'deleted on server' });
    });

    it('SET_ERROR sets the error unconditionally when no guard is given', () => {
      const prev: InternalCloudSyncState = { ...initialInternalState, cloudId: 'abc' };
      const next = cloudSyncReducer(prev, { type: 'SET_ERROR', error: 'oops' });
      expect(next.error).toBe('oops');
      expect(next.cloudId).toBe('abc');
    });

    it('SET_ERROR applies when the ifCloudId guard matches', () => {
      const prev: InternalCloudSyncState = { ...initialInternalState, cloudId: 'abc' };
      const next = cloudSyncReducer(prev, { type: 'SET_ERROR', error: 'oops', ifCloudId: 'abc' });
      expect(next.error).toBe('oops');
    });

    it('SET_ERROR is a no-op (returns prev) when the ifCloudId guard does not match', () => {
      const prev: InternalCloudSyncState = { ...initialInternalState, cloudId: 'abc' };
      const next = cloudSyncReducer(prev, { type: 'SET_ERROR', error: 'oops', ifCloudId: 'other' });
      expect(next).toBe(prev);
    });

    it('LIFECYCLE_RESET returns the frozen initialInternalState by reference', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
      };
      const next = cloudSyncReducer(prev, { type: 'LIFECYCLE_RESET' });
      // Reference equality preserves the sign-out Object.is bail-out no-op re-render.
      expect(next).toBe(initialInternalState);
    });

    it('LIFECYCLE_RESET on already-initial state is an Object.is no-op (same reference)', () => {
      const next = cloudSyncReducer(initialInternalState, { type: 'LIFECYCLE_RESET' });
      expect(Object.is(next, initialInternalState)).toBe(true);
    });

    it('OWNERSHIP_CONFIRMED promotes ownership/storage + version/time/visibility', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: false,
        storage: 'local',
        baseline: cleanBaseline(2),
      };
      const next = cloudSyncReducer(prev, {
        type: 'OWNERSHIP_CONFIRMED',
        ifCloudId: 'abc',
        serverVersion: 5,
        cloudSavedAt: '2026-02-02T00:00:00Z',
        visibility: 'unlisted',
      });
      expect(next.isOwner).toBe(true);
      expect(next.storage).toBe('cloud');
      expect(next.serverVersion).toBe(5);
      expect(next.lastCloudSavedAt).toBe('2026-02-02T00:00:00Z');
      expect(next.visibility).toBe('unlisted');
      // Unrelated fields preserved.
      expect(next.cloudId).toBe('abc');
      expect(next.baseline).toEqual(cleanBaseline(2));
    });

    it('OWNERSHIP_CONFIRMED is a no-op (returns prev) when the ifCloudId guard does not match', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: false,
      };
      const next = cloudSyncReducer(prev, {
        type: 'OWNERSHIP_CONFIRMED',
        ifCloudId: 'different',
        serverVersion: 5,
        cloudSavedAt: null,
        visibility: 'private',
      });
      expect(next).toBe(prev);
    });
  });

  describe('active-ops named actions (S5)', () => {
    it('BEGIN_SAVE sets saving status and clears error', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        error: 'old',
      };
      const next = cloudSyncReducer(prev, { type: 'BEGIN_SAVE' });
      expect(next).toEqual({ ...prev, status: 'saving', error: null });
    });

    it('MARK_SAVED records the updated arm fields and clears conflict', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        status: 'saving',
        serverVersion: 2,
        baseline: cleanBaseline(1),
        conflict: { serverVersion: 9 },
      };
      const next = cloudSyncReducer(prev, {
        type: 'MARK_SAVED',
        cloudSavedAt: '2026-03-03T00:00:00Z',
        serverVersion: 3,
        baselineVersion: 4,
      });
      expect(next).toEqual({
        ...prev,
        status: 'idle',
        lastCloudSavedAt: '2026-03-03T00:00:00Z',
        baseline: cleanBaseline(4),
        serverVersion: 3,
        conflict: null,
      });
    });

    it('MARK_CREATED performs the local→cloud transition', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        status: 'saving',
        storage: 'local',
        baseline: cleanBaseline(2),
      };
      const next = cloudSyncReducer(prev, {
        type: 'MARK_CREATED',
        cloudId: 'cloud9',
        shareUrl: 'https://example/p/cloud9',
        cloudSavedAt: '2026-04-04T00:00:00Z',
        serverVersion: 1,
        baselineVersion: 5,
      });
      expect(next).toEqual({
        ...prev,
        cloudId: 'cloud9',
        isOwner: true,
        storage: 'cloud',
        status: 'idle',
        shareUrl: 'https://example/p/cloud9',
        lastCloudSavedAt: '2026-04-04T00:00:00Z',
        baseline: cleanBaseline(5),
        serverVersion: 1,
        conflict: null,
      });
    });

    it('RECORD_SERVER_VERSION sets only serverVersion', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        status: 'saving',
        serverVersion: 2,
      };
      const next = cloudSyncReducer(prev, { type: 'RECORD_SERVER_VERSION', serverVersion: 7 });
      expect(next).toEqual({ ...prev, serverVersion: 7 });
    });

    it('NOT_FOUND_CLEARED clears cloud identity and sets the error', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        status: 'saving',
        shareUrl: 'https://example/p/abc',
        lastCloudSavedAt: '2026-01-01T00:00:00Z',
        visibility: 'unlisted',
      };
      const next = cloudSyncReducer(prev, { type: 'NOT_FOUND_CLEARED', error: 'gone' });
      expect(next).toEqual({
        ...prev,
        cloudId: null,
        isOwner: false,
        status: 'idle',
        shareUrl: null,
        lastCloudSavedAt: null,
        visibility: 'private',
        error: 'gone',
      });
    });

    it('CONFLICT_DIRTY sets idle, serverVersion, and the conflict marker', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        status: 'saving',
        serverVersion: 2,
      };
      const next = cloudSyncReducer(prev, { type: 'CONFLICT_DIRTY', serverVersion: 5 });
      expect(next).toEqual({
        ...prev,
        status: 'idle',
        serverVersion: 5,
        conflict: { serverVersion: 5 },
      });
    });

    it('CONFLICT_CLEAN sets idle and serverVersion but no conflict yet', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        status: 'saving',
        serverVersion: 2,
      };
      const next = cloudSyncReducer(prev, { type: 'CONFLICT_CLEAN', serverVersion: 5 });
      expect(next).toEqual({ ...prev, status: 'idle', serverVersion: 5 });
      expect(next.conflict).toBeNull();
    });

    it('SET_CONFLICT sets only the conflict marker', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        serverVersion: 5,
      };
      const next = cloudSyncReducer(prev, { type: 'SET_CONFLICT', serverVersion: 5 });
      expect(next).toEqual({ ...prev, conflict: { serverVersion: 5 } });
    });

    it('BEGIN_DELETE sets deleting status and clears error', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        error: 'old',
      };
      const next = cloudSyncReducer(prev, { type: 'BEGIN_DELETE' });
      expect(next).toEqual({ ...prev, status: 'deleting', error: null });
    });

    it('SET_VISIBILITY sets only visibility when no cloudSavedAt is given', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        visibility: 'private',
        lastCloudSavedAt: '2026-01-01T00:00:00Z',
      };
      const next = cloudSyncReducer(prev, { type: 'SET_VISIBILITY', visibility: 'unlisted' });
      expect(next).toEqual({ ...prev, visibility: 'unlisted' });
      // cloudSavedAt is untouched when not supplied
      expect(next.lastCloudSavedAt).toBe('2026-01-01T00:00:00Z');
    });

    it('SET_VISIBILITY advances cloudSavedAt when supplied (A-9 active path)', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        visibility: 'private',
        lastCloudSavedAt: '2026-01-01T00:00:00Z',
      };
      const next = cloudSyncReducer(prev, {
        type: 'SET_VISIBILITY',
        visibility: 'unlisted',
        cloudSavedAt: '2026-05-05T00:00:00Z',
      });
      expect(next).toEqual({
        ...prev,
        visibility: 'unlisted',
        lastCloudSavedAt: '2026-05-05T00:00:00Z',
      });
    });

    it('REVERT_VISIBILITY restores visibility and sets the error', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        visibility: 'unlisted',
      };
      const next = cloudSyncReducer(prev, {
        type: 'REVERT_VISIBILITY',
        visibility: 'private',
        error: 'Failed to update visibility.',
      });
      expect(next).toEqual({
        ...prev,
        visibility: 'private',
        error: 'Failed to update visibility.',
      });
    });

    it('BEGIN_LOAD sets loading status, clears error, and seeds cloudId', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        error: 'old',
      };
      const next = cloudSyncReducer(prev, { type: 'BEGIN_LOAD', cloudId: 'abc' });
      expect(next).toEqual({ ...prev, status: 'loading', error: null, cloudId: 'abc' });
    });

    it('LOAD_SUCCEEDED merges the import-result seed over prev', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        status: 'loading',
        cloudId: 'abc',
      };
      const next = cloudSyncReducer(prev, {
        type: 'LOAD_SUCCEEDED',
        seed: {
          cloudId: 'abc',
          isOwner: true,
          storage: 'cloud',
          status: 'idle',
          shareUrl: 'https://example/p/abc',
          lastCloudSavedAt: '2026-06-06T00:00:00Z',
          serverVersion: 5,
          visibility: 'unlisted',
        },
      });
      expect(next).toEqual({
        ...prev,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        status: 'idle',
        shareUrl: 'https://example/p/abc',
        lastCloudSavedAt: '2026-06-06T00:00:00Z',
        serverVersion: 5,
        visibility: 'unlisted',
      });
    });

    it('LOAD_FAILED sets idle and error without clearing cloudId by default', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        status: 'loading',
        cloudId: 'abc',
      };
      const next = cloudSyncReducer(prev, { type: 'LOAD_FAILED', error: 'boom' });
      expect(next).toEqual({ ...prev, status: 'idle', error: 'boom' });
      expect(next.cloudId).toBe('abc');
    });

    it('LOAD_FAILED clears cloudId when clearCloudId is set', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        status: 'loading',
        cloudId: 'abc',
      };
      const next = cloudSyncReducer(prev, {
        type: 'LOAD_FAILED',
        error: 'not found',
        clearCloudId: true,
      });
      expect(next).toEqual({ ...prev, status: 'idle', error: 'not found', cloudId: null });
    });
  });

  describe('named actions (S7)', () => {
    it('APPLY_PULL applies the freshness pull result and clears any conflict', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        serverVersion: 1,
        lastCloudSavedAt: '2026-06-01T00:00:00Z',
        visibility: 'private',
        conflict: { serverVersion: 4 },
      };
      const next = cloudSyncReducer(prev, {
        type: 'APPLY_PULL',
        serverVersion: 3,
        cloudSavedAt: '2026-06-06T00:00:00Z',
        visibility: 'unlisted',
      });
      expect(next).toEqual({
        ...prev,
        serverVersion: 3,
        lastCloudSavedAt: '2026-06-06T00:00:00Z',
        visibility: 'unlisted',
        conflict: null,
      });
    });

    it('APPLY_PULL accepts a null cloudSavedAt', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        serverVersion: 1,
      };
      const next = cloudSyncReducer(prev, {
        type: 'APPLY_PULL',
        serverVersion: 2,
        cloudSavedAt: null,
        visibility: 'unlisted',
      });
      expect(next.lastCloudSavedAt).toBeNull();
      expect(next.serverVersion).toBe(2);
      expect(next.visibility).toBe('unlisted');
      expect(next.conflict).toBeNull();
    });

    it('OP_FAILED sets status idle and the error message, preserving other fields', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        status: 'saving',
        serverVersion: 7,
      };
      const next = cloudSyncReducer(prev, { type: 'OP_FAILED', error: 'Failed to save copy.' });
      expect(next).toEqual({ ...prev, status: 'idle', error: 'Failed to save copy.' });
      expect(next.cloudId).toBe('abc');
      expect(next.serverVersion).toBe(7);
    });
  });

  // S8/S14a: the version-sync handshake — replaces needsVersionSyncRef. The
  // "awaiting capture" marker is now `baseline:{untracked}`.
  describe('baseline-capture handshake (S8)', () => {
    it('REQUEST_BASELINE sets the untracked (awaiting-capture) baseline, preserving other fields', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        baseline: cleanBaseline(7),
        serverVersion: 3,
      };
      const next = cloudSyncReducer(prev, { type: 'REQUEST_BASELINE' });
      // `{untracked}` doubles as the awaiting-capture marker; the engine captures
      // the post-increment generation into a clean baseline on its next tick.
      expect(next.baseline).toEqual(untrackedBaseline());
      expect(next.cloudId).toBe('abc');
      expect(next.serverVersion).toBe(3);
    });

    it('CAPTURE_BASELINE records the supplied version as a clean baseline', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        baseline: untrackedBaseline(),
      };
      const next = cloudSyncReducer(prev, { type: 'CAPTURE_BASELINE', version: 5 });
      expect(next.baseline).toEqual(cleanBaseline(5));
      expect(next.cloudId).toBe('abc');
    });
  });

  // S10a: the pure init-seed builder shared by both init paths.
  describe('cloudStateForEntry (S10a)', () => {
    const base: CloudEntrySeed = {
      prev: initialInternalState,
      cloudId: 'cloud123',
      isOwner: true,
      storage: 'cloud',
      shareUrl: 'https://example/p/cloud123',
      lastCloudSavedAt: '2026-01-01T00:00:00Z',
      visibility: 'unlisted',
      serverVersion: 7,
      conflictVersion: null,
      hasUnsyncedChanges: false,
      dataVersion: 4,
    };

    it('builds the flat cloud INIT state, spreading prev underneath', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        // A field not overwritten by the seed should survive (proves the spread).
        asyncTransient: 'syncing',
      };
      const next = cloudStateForEntry({ ...base, prev });
      expect(next).toEqual({
        ...prev,
        cloudId: 'cloud123',
        isOwner: true,
        storage: 'cloud',
        shareUrl: 'https://example/p/cloud123',
        baseline: cleanBaseline(4),
        lastCloudSavedAt: '2026-01-01T00:00:00Z',
        error: null,
        visibility: 'unlisted',
        serverVersion: 7,
        conflict: null,
      });
      // Untouched prev field carries through.
      expect(next.asyncTransient).toBe('syncing');
    });

    it('seeds a clean baseline at the current generation when there are no unsynced changes', () => {
      const next = cloudStateForEntry({ ...base, hasUnsyncedChanges: false, dataVersion: 11 });
      expect(next.baseline).toEqual(cleanBaseline(11));
    });

    it('seeds a dirty baseline when stored unsynced changes exist', () => {
      const next = cloudStateForEntry({ ...base, hasUnsyncedChanges: true, dataVersion: 11 });
      expect(next.baseline).toEqual(dirtyBaseline());
    });

    it('carries lastCloudSavedAt from the seed verbatim — Path A threads metadata.cloudSavedAt', () => {
      const next = cloudStateForEntry({ ...base, lastCloudSavedAt: '2026-02-02T00:00:00Z' });
      expect(next.lastCloudSavedAt).toBe('2026-02-02T00:00:00Z');
    });

    it('carries a null lastCloudSavedAt from the seed verbatim — Path B hardcodes null', () => {
      const next = cloudStateForEntry({ ...base, lastCloudSavedAt: null });
      expect(next.lastCloudSavedAt).toBeNull();
    });

    it('sets the conflict marker from conflictVersion when present', () => {
      const next = cloudStateForEntry({ ...base, conflictVersion: 9 });
      expect(next.conflict).toEqual({ serverVersion: 9 });
    });

    it('leaves conflict null when conflictVersion is null', () => {
      const next = cloudStateForEntry({ ...base, conflictVersion: null });
      expect(next.conflict).toBeNull();
    });

    it('always clears error on entry', () => {
      const next = cloudStateForEntry({ ...base, prev: { ...initialInternalState, error: 'stale' } });
      expect(next.error).toBeNull();
    });

    it('feeds INIT_CLOUD as the seed — the single materialize transition', () => {
      const seed = cloudStateForEntry(base);
      const next = cloudSyncReducer(initialInternalState, { type: 'INIT_CLOUD', seed });
      expect(next).toBe(seed);
    });
  });

  // S9: the async sync/offline transient — replaces the engine's asyncOverride useState.
  describe('async transient (S9)', () => {
    it('SET_ASYNC_TRANSIENT sets the syncing overlay, preserving other fields', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        isOwner: true,
        storage: 'cloud',
        status: 'idle',
        serverVersion: 3,
      };
      const next = cloudSyncReducer(prev, { type: 'SET_ASYNC_TRANSIENT', value: 'syncing' });
      expect(next.asyncTransient).toBe('syncing');
      // The overlay does NOT touch the underlying op status.
      expect(next.status).toBe('idle');
      expect(next.cloudId).toBe('abc');
      expect(next.serverVersion).toBe(3);
    });

    it('SET_ASYNC_TRANSIENT sets the offline overlay', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        asyncTransient: 'syncing',
      };
      const next = cloudSyncReducer(prev, { type: 'SET_ASYNC_TRANSIENT', value: 'offline' });
      expect(next.asyncTransient).toBe('offline');
    });

    it('SET_ASYNC_TRANSIENT clears the overlay with null (microtask cleanup)', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        cloudId: 'abc',
        status: 'saving',
        asyncTransient: 'offline',
      };
      const next = cloudSyncReducer(prev, { type: 'SET_ASYNC_TRANSIENT', value: null });
      expect(next.asyncTransient).toBeNull();
      // Clearing the overlay must NOT clobber the underlying op status.
      expect(next.status).toBe('saving');
    });
  });
});

// S14a: the pure dirtiness predicate. Byte-for-byte equal to the engine's former
// `cloudId !== null && lastSavedVersion >= 0 && dataVersion !== lastSavedVersion`.
describe('isDirty (S14a)', () => {
  it('is false for any baseline when cloudId is null (local-only never auto-syncs)', () => {
    expect(isDirty(untrackedBaseline(), null, 5)).toBe(false);
    expect(isDirty(dirtyBaseline(), null, 5)).toBe(false);
    expect(isDirty(cleanBaseline(5), null, 5)).toBe(false);
    expect(isDirty(cleanBaseline(3), null, 5)).toBe(false);
  });

  it('is false for an untracked baseline (former lastSavedVersion >= 0 guard)', () => {
    expect(isDirty(untrackedBaseline(), 'cloud-1', 0)).toBe(false);
    expect(isDirty(untrackedBaseline(), 'cloud-1', 7)).toBe(false);
  });

  it('is true for a dirty baseline (former MAX_SAFE_INTEGER sentinel)', () => {
    expect(isDirty(dirtyBaseline(), 'cloud-1', 0)).toBe(true);
    expect(isDirty(dirtyBaseline(), 'cloud-1', 99)).toBe(true);
  });

  it('compares the generation for a clean baseline', () => {
    expect(isDirty(cleanBaseline(5), 'cloud-1', 5)).toBe(false);
    expect(isDirty(cleanBaseline(5), 'cloud-1', 6)).toBe(true);
    expect(isDirty(cleanBaseline(5), 'cloud-1', 4)).toBe(true);
  });
});

// S14a: equivalence oracle (DESIGN §9). Proves the `lastSavedVersion → baseline`
// collapse is behavior-preserving by mapping the NEW state back to the LEGACY
// flat shape after each action and comparing against the hand-written legacy
// result. `status` and `asyncTransient` map identity — including the auto-sync
// save window where both are simultaneously non-default, which the (rejected)
// `Phase` merge could not encode. Oracle scaffolding is removed in S14b.
describe('toInternalCloudSyncState equivalence oracle (S14a)', () => {
  it('maps each baseline kind back to its legacy lastSavedVersion sentinel', () => {
    expect(toInternalCloudSyncState({ ...initialInternalState, baseline: untrackedBaseline() }))
      .toMatchObject({ lastSavedVersion: -1, awaitingBaselineCapture: false });
    expect(toInternalCloudSyncState({ ...initialInternalState, baseline: dirtyBaseline() }))
      .toMatchObject({ lastSavedVersion: Number.MAX_SAFE_INTEGER, awaitingBaselineCapture: false });
    expect(toInternalCloudSyncState({ ...initialInternalState, baseline: cleanBaseline(3) }))
      .toMatchObject({ lastSavedVersion: 3, awaitingBaselineCapture: false });
  });

  it('recovers the legacy awaitingBaselineCapture flag from an untracked CLOUD baseline', () => {
    // untracked + cloudId set === the awaiting-capture window.
    const awaiting = toInternalCloudSyncState({
      ...initialInternalState, cloudId: 'cloud-1', baseline: untrackedBaseline(),
    });
    expect(awaiting.lastSavedVersion).toBe(-1);
    expect(awaiting.awaitingBaselineCapture).toBe(true);
  });

  it('round-trips the clean-save sequence to the legacy flat state', () => {
    // BEGIN_SAVE (status:saving) → MARK_SAVED (clean baseline). The legacy state
    // is the hand-written flat equivalent.
    let state: InternalCloudSyncState = {
      ...initialInternalState, cloudId: 'cloud-1', isOwner: true, storage: 'cloud',
      serverVersion: 2, baseline: cleanBaseline(1),
    };
    state = cloudSyncReducer(state, { type: 'BEGIN_SAVE' });
    state = cloudSyncReducer(state, {
      type: 'MARK_SAVED', cloudSavedAt: '2026-03-03T00:00:00Z', serverVersion: 3, baselineVersion: 4,
    });
    expect(toInternalCloudSyncState(state)).toEqual({
      cloudId: 'cloud-1', isOwner: true, storage: 'cloud', status: 'idle', error: null,
      shareUrl: null, lastCloudSavedAt: '2026-03-03T00:00:00Z', lastSavedVersion: 4,
      awaitingBaselineCapture: false, visibility: 'private', serverVersion: 3, conflict: null,
    });
  });

  it('round-trips the auto-sync save window (status + asyncTransient both non-default)', () => {
    // BEGIN_SAVE sets status:'saving'; SET_ASYNC_TRANSIENT('syncing') overlays the
    // async transient. Both must survive identity-mapped (the rejected Phase merge
    // could not hold both at once).
    let state: InternalCloudSyncState = {
      ...initialInternalState, cloudId: 'cloud-1', isOwner: true, storage: 'cloud',
      baseline: cleanBaseline(1),
    };
    state = cloudSyncReducer(state, { type: 'BEGIN_SAVE' });
    state = cloudSyncReducer(state, { type: 'SET_ASYNC_TRANSIENT', value: 'syncing' });
    const legacy = toInternalCloudSyncState(state);
    expect(legacy.status).toBe('saving');
    expect(legacy.asyncTransient).toBe('syncing');
    expect(legacy.lastSavedVersion).toBe(1);
  });

  it('round-trips the baseline-capture handshake (REQUEST → CAPTURE)', () => {
    let state: InternalCloudSyncState = {
      ...initialInternalState, cloudId: 'cloud-1', isOwner: true, storage: 'cloud',
      baseline: cleanBaseline(2),
    };
    state = cloudSyncReducer(state, { type: 'REQUEST_BASELINE' });
    // Awaiting window: untracked + cloudId === legacy lastSavedVersion -1 + flag.
    expect(toInternalCloudSyncState(state)).toMatchObject({
      lastSavedVersion: -1, awaitingBaselineCapture: true,
    });
    state = cloudSyncReducer(state, { type: 'CAPTURE_BASELINE', version: 9 });
    expect(toInternalCloudSyncState(state)).toMatchObject({
      lastSavedVersion: 9, awaitingBaselineCapture: false,
    });
  });

  it('round-trips the stored-unsynced cloud entry to the legacy dirty sentinel', () => {
    const seed = cloudStateForEntry({
      prev: initialInternalState,
      cloudId: 'cloud-1', isOwner: true, storage: 'cloud',
      shareUrl: 'https://example/p/cloud-1', lastCloudSavedAt: null,
      visibility: 'private', serverVersion: 5, conflictVersion: null,
      hasUnsyncedChanges: true, dataVersion: 4,
    });
    const state = cloudSyncReducer(initialInternalState, { type: 'INIT_CLOUD', seed });
    expect(toInternalCloudSyncState(state)).toMatchObject({
      lastSavedVersion: Number.MAX_SAFE_INTEGER, awaitingBaselineCapture: false,
    });
  });
});
