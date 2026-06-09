import { describe, it, expect } from 'vitest';
import { cloudSyncReducer } from './cloud-sync-reducer';
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
        lastSavedVersion: 4,
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
        lastSavedVersion: 2,
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
      expect(next.lastSavedVersion).toBe(2);
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
        lastSavedVersion: 1,
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
        lastSavedVersion: 4,
        serverVersion: 3,
        conflict: null,
      });
    });

    it('MARK_CREATED performs the local→cloud transition', () => {
      const prev: InternalCloudSyncState = {
        ...initialInternalState,
        status: 'saving',
        storage: 'local',
        lastSavedVersion: 2,
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
        lastSavedVersion: 5,
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
});
