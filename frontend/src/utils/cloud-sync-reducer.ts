import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';
import type { Visibility } from '../types/project';

/**
 * Reducer foundation for the cloud-sync provider (consolidation slice S3+).
 *
 * Pure and React-free, mirroring `cloud-sync.ts`'s injected-callback purity.
 * Operates over the existing flat `InternalCloudSyncState` shape — the
 * `Baseline`/`Phase` split is a later slice (S14). Each named-action handler
 * reproduces, byte-for-byte, the `__RAW` updater it replaces on the current
 * flat shape.
 *
 * The `__RAW` action whose handler applies the supplied updater verbatim is
 * retained for the still-unconverted writers (S5–S7 modules): a functional
 * updater is forwarded as-is, and a value update is wrapped in `() => value` by
 * the provider's shim.
 *
 * S4 named actions (provider-owned writers — initFromProject, dismissError,
 * stale-reconcile, ownership-reeval):
 * - `INIT_LOCAL { storage }`  → `{ ...initialInternalState, storage }`
 * - `INIT_CLOUD { seed }`     → the supplied flat seed verbatim
 * - `CLEAR_ERROR`             → `{ ...prev, error: null }`
 * - `RESET_WITH_ERROR { error }` → `{ ...initialInternalState, error }`
 * - `SET_ERROR { error, ifCloudId? }` → `{ ...prev, error }`, optionally
 *   guarded so it only applies when `prev.cloudId === ifCloudId` (preserves the
 *   `prev.cloudId === id ? … : prev` concurrency guard at the call sites)
 * - `LIFECYCLE_RESET`         → the FROZEN `initialInternalState` reference (not
 *   a fresh copy), preserving the sign-out `Object.is` bail-out no-op re-render
 *   (`cloud-sync.ts` / `types/cloud-sync.ts` `initialInternalState` docstring)
 * - `OWNERSHIP_CONFIRMED { serverVersion, cloudSavedAt, visibility, ifCloudId }`
 *   → promote `isOwner`/`storage` + version/time/visibility, guarded on cloudId
 */
export type CloudSyncAction =
  | {
      type: '__RAW';
      updater: (prev: InternalCloudSyncState) => InternalCloudSyncState;
    }
  | { type: 'INIT_LOCAL'; storage: 'local' | 'cloud' }
  | { type: 'INIT_CLOUD'; seed: InternalCloudSyncState }
  | { type: 'CLEAR_ERROR' }
  | { type: 'RESET_WITH_ERROR'; error: string }
  | { type: 'SET_ERROR'; error: string; ifCloudId?: string }
  | { type: 'LIFECYCLE_RESET' }
  | {
      type: 'OWNERSHIP_CONFIRMED';
      ifCloudId: string;
      serverVersion: number;
      cloudSavedAt: string | null;
      visibility: Visibility;
    };

export function cloudSyncReducer(
  state: InternalCloudSyncState,
  action: CloudSyncAction,
): InternalCloudSyncState {
  switch (action.type) {
    case '__RAW':
      return action.updater(state);
    case 'INIT_LOCAL':
      return { ...initialInternalState, storage: action.storage };
    case 'INIT_CLOUD':
      return action.seed;
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'RESET_WITH_ERROR':
      return { ...initialInternalState, error: action.error };
    case 'SET_ERROR':
      // Optional cloudId guard preserves the `prev.cloudId === id ? … : prev`
      // concurrency check at the stale-reconcile / ownership-reeval call sites.
      if (action.ifCloudId !== undefined && state.cloudId !== action.ifCloudId) return state;
      return { ...state, error: action.error };
    case 'LIFECYCLE_RESET':
      // Return the frozen singleton by reference (not a copy) so a reset to the
      // already-initial state is an Object.is bail-out no-op re-render.
      return initialInternalState;
    case 'OWNERSHIP_CONFIRMED':
      if (state.cloudId !== action.ifCloudId) return state;
      return {
        ...state,
        isOwner: true,
        storage: 'cloud',
        serverVersion: action.serverVersion,
        lastCloudSavedAt: action.cloudSavedAt,
        visibility: action.visibility,
      };
    default: {
      // Exhaustiveness guard: a later slice that adds an action without a case
      // here gets a compile error. Returns `state` unchanged at runtime.
      const _exhaustive: never = action;
      return _exhaustive ?? state;
    }
  }
}
