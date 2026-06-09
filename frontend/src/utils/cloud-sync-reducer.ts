import type { InternalCloudSyncState } from '../types/cloud-sync';

/**
 * Reducer foundation for the cloud-sync provider (consolidation slice S3).
 *
 * Pure and React-free, mirroring `cloud-sync.ts`'s injected-callback purity.
 * Operates over the existing flat `InternalCloudSyncState` shape — the
 * `Baseline`/`Phase` split is a later slice (S14).
 *
 * For now there is a single `__RAW` action whose handler applies the supplied
 * updater verbatim. This makes the `useState`→`useReducer` swap invisible to
 * every caller of `setInternal`: a functional updater is forwarded as-is, and a
 * value update is wrapped in `() => value` by the provider's shim. Later slices
 * (S4–S7) convert these `__RAW` calls to named actions.
 */
export type CloudSyncAction = {
  type: '__RAW';
  updater: (prev: InternalCloudSyncState) => InternalCloudSyncState;
};

export function cloudSyncReducer(
  state: InternalCloudSyncState,
  action: CloudSyncAction,
): InternalCloudSyncState {
  switch (action.type) {
    case '__RAW':
      return action.updater(state);
  }
}
