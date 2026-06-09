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
 *
 * S5 named actions (active-ops writers — saveToCloud / applyCreated / fork /
 * delete / visibility / load). All operate on the current flat shape; the
 * DESIGN §2 `baseline`/`phase` effects map to the present `lastSavedVersion`/
 * `status` fields:
 * - `BEGIN_SAVE`                 → `{ status:'saving', error:null }`
 * - `MARK_SAVED { cloudSavedAt, serverVersion, baselineVersion }`
 *   → `{ status:'idle', lastCloudSavedAt, lastSavedVersion, serverVersion, conflict:null }`
 * - `MARK_CREATED { cloudId, shareUrl, cloudSavedAt, serverVersion, baselineVersion }`
 *   → the local→cloud transition
 * - `RECORD_SERVER_VERSION { serverVersion }` → `serverVersion` only
 * - `NOT_FOUND_CLEARED { error }` → clears cloud identity, sets error
 * - `CONFLICT_DIRTY { serverVersion }`  → `{ status:'idle', serverVersion, conflict }`
 * - `CONFLICT_CLEAN { serverVersion }`  → `{ status:'idle', serverVersion }`
 * - `SET_CONFLICT { serverVersion }`    → `{ conflict:{serverVersion} }`
 * - `BEGIN_DELETE`               → `{ status:'deleting', error:null }`
 * - `SET_VISIBILITY { visibility, cloudSavedAt? }` → optimistic visibility (+ A-9
 *   active-path `lastCloudSavedAt` when supplied)
 * - `REVERT_VISIBILITY { visibility, error }` → revert + error
 * - `BEGIN_LOAD { cloudId }`     → `{ status:'loading', error:null, cloudId }`
 * - `LOAD_SUCCEEDED { seed }`    → merge the import-result seed over prev
 * - `LOAD_FAILED { error, clearCloudId? }` → `{ status:'idle', error }` (+ cloudId clear)
 *
 * S7 named actions (auth-transition + freshness writers; OP_FAILED mop-up):
 * - `APPLY_PULL { serverVersion, cloudSavedAt, visibility }`
 *   → `{ ...prev, serverVersion, lastCloudSavedAt, visibility, conflict:null }`
 *   (the freshness-pull apply at `cloud-freshness.ts` `checkAndPullFreshVersion`)
 * - `OP_FAILED { error }` → `{ ...prev, status:'idle', error }` (the flat-shape
 *   "operation failed → idle + error" transition; converts the active-ops
 *   save/fork/delete/load failure arms that today write that shape raw)
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
    }
  | { type: 'BEGIN_SAVE' }
  | {
      type: 'MARK_SAVED';
      cloudSavedAt: string;
      serverVersion: number;
      baselineVersion: number;
    }
  | {
      type: 'MARK_CREATED';
      cloudId: string;
      shareUrl: string;
      cloudSavedAt: string;
      serverVersion: number;
      baselineVersion: number;
    }
  | { type: 'RECORD_SERVER_VERSION'; serverVersion: number }
  | { type: 'NOT_FOUND_CLEARED'; error: string }
  | { type: 'CONFLICT_DIRTY'; serverVersion: number }
  | { type: 'CONFLICT_CLEAN'; serverVersion: number }
  | { type: 'SET_CONFLICT'; serverVersion: number }
  | { type: 'BEGIN_DELETE' }
  | { type: 'SET_VISIBILITY'; visibility: Visibility; cloudSavedAt?: string }
  | { type: 'REVERT_VISIBILITY'; visibility: Visibility; error: string }
  | { type: 'BEGIN_LOAD'; cloudId: string }
  | {
      type: 'LOAD_SUCCEEDED';
      seed: Pick<
        InternalCloudSyncState,
        | 'cloudId' | 'isOwner' | 'storage' | 'status' | 'shareUrl'
        | 'lastCloudSavedAt' | 'serverVersion' | 'visibility'
      >;
    }
  | { type: 'LOAD_FAILED'; error: string; clearCloudId?: boolean }
  | {
      type: 'APPLY_PULL';
      serverVersion: number;
      cloudSavedAt: string | null;
      visibility: Visibility;
    }
  | { type: 'OP_FAILED'; error: string };

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
    case 'BEGIN_SAVE':
      return { ...state, status: 'saving', error: null };
    case 'MARK_SAVED':
      return {
        ...state,
        status: 'idle',
        lastCloudSavedAt: action.cloudSavedAt,
        lastSavedVersion: action.baselineVersion,
        serverVersion: action.serverVersion,
        conflict: null,
      };
    case 'MARK_CREATED':
      return {
        ...state,
        cloudId: action.cloudId,
        isOwner: true,
        storage: 'cloud',
        status: 'idle',
        shareUrl: action.shareUrl,
        lastCloudSavedAt: action.cloudSavedAt,
        lastSavedVersion: action.baselineVersion,
        serverVersion: action.serverVersion,
        conflict: null,
      };
    case 'RECORD_SERVER_VERSION':
      return { ...state, serverVersion: action.serverVersion };
    case 'NOT_FOUND_CLEARED':
      return {
        ...state,
        cloudId: null,
        isOwner: false,
        status: 'idle',
        shareUrl: null,
        lastCloudSavedAt: null,
        visibility: 'private',
        error: action.error,
      };
    case 'CONFLICT_DIRTY':
      return {
        ...state,
        status: 'idle',
        serverVersion: action.serverVersion,
        conflict: { serverVersion: action.serverVersion },
      };
    case 'CONFLICT_CLEAN':
      return { ...state, status: 'idle', serverVersion: action.serverVersion };
    case 'SET_CONFLICT':
      return { ...state, conflict: { serverVersion: action.serverVersion } };
    case 'BEGIN_DELETE':
      return { ...state, status: 'deleting', error: null };
    case 'SET_VISIBILITY':
      // The optional cloudSavedAt advances lastCloudSavedAt only when supplied
      // (A-9 active path); the optimistic write omits it.
      return action.cloudSavedAt !== undefined
        ? { ...state, visibility: action.visibility, lastCloudSavedAt: action.cloudSavedAt }
        : { ...state, visibility: action.visibility };
    case 'REVERT_VISIBILITY':
      return { ...state, visibility: action.visibility, error: action.error };
    case 'BEGIN_LOAD':
      return { ...state, status: 'loading', error: null, cloudId: action.cloudId };
    case 'LOAD_SUCCEEDED':
      return { ...state, ...action.seed };
    case 'LOAD_FAILED':
      return action.clearCloudId
        ? { ...state, status: 'idle', error: action.error, cloudId: null }
        : { ...state, status: 'idle', error: action.error };
    case 'APPLY_PULL':
      return {
        ...state,
        serverVersion: action.serverVersion,
        lastCloudSavedAt: action.cloudSavedAt,
        visibility: action.visibility,
        conflict: null,
      };
    case 'OP_FAILED':
      return { ...state, status: 'idle', error: action.error };
    default: {
      // Exhaustiveness guard: a later slice that adds an action without a case
      // here gets a compile error. Returns `state` unchanged at runtime.
      const _exhaustive: never = action;
      return _exhaustive ?? state;
    }
  }
}
