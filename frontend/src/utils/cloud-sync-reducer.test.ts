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
});
