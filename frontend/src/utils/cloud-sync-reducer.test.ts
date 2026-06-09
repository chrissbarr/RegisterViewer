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
});
