import { initialInternalState, type Baseline, type InternalCloudSyncState } from '../types/cloud-sync';
import type { Visibility } from '../types/project';

/** Baseline constructors (S14a) — terse builders for the discriminated union. */
export const untrackedBaseline = (): Baseline => ({ kind: 'untracked' });
export const dirtyBaseline = (): Baseline => ({ kind: 'dirty' });
export const cleanBaseline = (version: number): Baseline => ({ kind: 'clean', version });

/**
 * Pure dirtiness predicate (S14a / DESIGN §1). Byte-for-byte equal to the
 * engine's former expression
 * `cloudId !== null && lastSavedVersion >= 0 && dataVersion !== lastSavedVersion`:
 * - `cloudId === null` → false (local-only project never auto-syncs).
 * - `untracked` → false (the former `lastSavedVersion >= 0` guard was false at -1).
 * - `dirty` → true (the former `MAX_SAFE_INTEGER !== dataVersion`).
 * - `clean` → `dataVersion !== version` (a real generation comparison).
 */
export function isDirty(baseline: Baseline, cloudId: string | null, dataVersion: number): boolean {
  if (cloudId === null) return false;
  switch (baseline.kind) {
    case 'untracked':
      return false;
    case 'dirty':
      return true;
    case 'clean':
      return dataVersion !== baseline.version;
  }
}

/**
 * Selector for the departure snapshotter (DESIGN §5): whether the active cloud
 * project has unsaved edits. Identical to `isDirty(state.baseline, …)`.
 */
export function selectWasDirty(state: InternalCloudSyncState, dataVersion: number): boolean {
  return isDirty(state.baseline, state.cloudId, dataVersion);
}

/**
 * Reducer foundation for the cloud-sync provider (consolidation slice S3+).
 *
 * Pure and React-free, mirroring `cloud-sync.ts`'s injected-callback purity.
 * Operates over `InternalCloudSyncState`. S14a collapsed the former
 * `lastSavedVersion` sentinel (and the S8 `awaitingBaselineCapture` flag) into
 * the `baseline: Baseline` discriminated union; `status` and `asyncTransient`
 * remain two separate fields. S14b removed the temporary `__RAW` passthrough:
 * every writer now dispatches a named action and the closed action set is covered
 * by the exhaustiveness `default`.
 *
 * S4 named actions (provider-owned writers — initFromProject, dismissError,
 * stale-reconcile, ownership-reeval):
 * - `INIT_LOCAL { storage }`  → `{ ...initialInternalState, storage }`
 * - `INIT_CLOUD { seed }`     → the supplied flat seed verbatim
 * - `CLEAR_ERROR`             → `{ ...prev, error: null }`
 * - `CLEAR_CONFLICT`          → `{ ...prev, conflict: null }` (S14b — the
 *   loadServerVersion post-pull conflict clear that was a raw `__RAW` updater)
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
 * delete / visibility / load). The DESIGN §2 `baseline` effects write the
 * `baseline` union (S14a); `status` is its own field:
 * - `BEGIN_SAVE`                 → `{ status:'saving', error:null }`
 * - `MARK_SAVED { cloudSavedAt, serverVersion, baselineVersion }`
 *   → `{ status:'idle', lastCloudSavedAt, baseline:{clean,version}, serverVersion, conflict:null }`
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
 *
 * S8 version-sync handshake (replaces `needsVersionSyncRef` — the three
 * true-writers + the engine reader). Operates on the `baseline` field (S14a):
 * - `REQUEST_BASELINE` → `{ ...prev, baseline:{kind:'untracked'} }`, the
 *   one-shot "awaiting capture" marker the writers (switch-init / load /
 *   freshness-pull) set after adopting a new cloud baseline. `{untracked}`
 *   doubles as the marker; the engine captures when `cloudId !== null`.
 * - `CAPTURE_BASELINE { version }` → `{ ...prev, baseline:{kind:'clean',version} }`,
 *   dispatched by the engine at the post-increment effect tick with
 *   `dataVersionRef.current`
 *
 * S9 async sync/offline transient (replaces the engine-local `asyncOverride`
 * useState). Operates on the current flat shape via the transient
 * `asyncTransient` field:
 * - `SET_ASYNC_TRANSIENT { value }` → `{ ...prev, asyncTransient: value }`, the
 *   `'syncing'`/`'offline'`/`null` overlay the auto-sync engine sets from its
 *   async callbacks and microtask-clears on cleanup. Does NOT touch `status`
 *   (the underlying op lifecycle is independent).
 */
export type CloudSyncAction =
  | { type: 'INIT_LOCAL'; storage: 'local' | 'cloud' }
  | { type: 'INIT_CLOUD'; seed: InternalCloudSyncState }
  | { type: 'CLEAR_ERROR' }
  | { type: 'CLEAR_CONFLICT' }
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
  | { type: 'OP_FAILED'; error: string }
  | { type: 'REQUEST_BASELINE' }
  | { type: 'CAPTURE_BASELINE'; version: number }
  | { type: 'SET_ASYNC_TRANSIENT'; value: 'syncing' | 'offline' | null };

/**
 * Inputs to {@link cloudStateForEntry}, the pure builder shared by both cloud
 * INIT paths (S10a — DESIGN §3a). Carries exactly the values that vary between
 * Path A (`initFromProject`) and Path B (`useProjectSwitchInit`), so each
 * divergence is a visible seed field rather than a buried per-path difference.
 */
export interface CloudEntrySeed {
  /** State to spread underneath — both paths spread `internalRef.current`. */
  prev: InternalCloudSyncState;
  cloudId: string;
  isOwner: boolean;
  storage: 'local' | 'cloud';
  shareUrl: string;
  /**
   * The A-9 divergence made visible: Path A threads `metadata.cloudSavedAt`,
   * Path B hardcodes `null`. Carried in the seed instead of inside the builder.
   */
  lastCloudSavedAt: string | null;
  visibility: Visibility;
  /** Already-normalized server version (0 = unknown). */
  serverVersion: number;
  /** Conflict version, or null when there is no recorded conflict. */
  conflictVersion: number | null;
  /**
   * Whether the stored payload already needs saving. Drives the `dirty` baseline
   * vs. a `clean` snapshot of the current generation (the clean case the callers
   * convert to "awaiting capture" via a follow-up `REQUEST_BASELINE`).
   */
  hasUnsyncedChanges: boolean;
  /** The engine's current generation (`dataVersionRef.current`). */
  dataVersion: number;
}

/**
 * Pure builder for the cloud INIT state, consumed by `INIT_CLOUD` from BOTH init
 * paths (`initFromProject` and `useProjectSwitchInit`). Returns an
 * `InternalCloudSyncState` (with the S14a `baseline` union) — the same state the
 * temporary inline seed builders produced. The four documented
 * divergences (`setCloudUrl`, baseline seeding, freshness kickoff,
 * `lastCloudSavedAt`) live in the callers as explicit post-steps; this builder
 * only owns the shape, with the `lastCloudSavedAt` divergence carried in the seed.
 */
export function cloudStateForEntry(seed: CloudEntrySeed): InternalCloudSyncState {
  return {
    ...seed.prev,
    cloudId: seed.cloudId,
    isOwner: seed.isOwner,
    storage: seed.storage,
    shareUrl: seed.shareUrl,
    // A `dirty` baseline keeps a stored-unsynced payload dirty until the first
    // save; otherwise snapshot the current generation as a `clean` baseline
    // (the callers then dispatch REQUEST_BASELINE to await capture on the next
    // engine tick — see DESIGN §3a).
    baseline: seed.hasUnsyncedChanges ? dirtyBaseline() : cleanBaseline(seed.dataVersion),
    lastCloudSavedAt: seed.lastCloudSavedAt,
    error: null,
    visibility: seed.visibility,
    serverVersion: seed.serverVersion,
    conflict: seed.conflictVersion ? { serverVersion: seed.conflictVersion } : null,
  };
}

export function cloudSyncReducer(
  state: InternalCloudSyncState,
  action: CloudSyncAction,
): InternalCloudSyncState {
  switch (action.type) {
    case 'INIT_LOCAL':
      return { ...initialInternalState, storage: action.storage };
    case 'INIT_CLOUD':
      return action.seed;
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'CLEAR_CONFLICT':
      // Belt-and-suspenders conflict clear used by loadServerVersion after a
      // successful replace-with-server pull (APPLY_PULL already cleared it).
      return { ...state, conflict: null };
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
        baseline: cleanBaseline(action.baselineVersion),
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
        baseline: cleanBaseline(action.baselineVersion),
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
    case 'REQUEST_BASELINE':
      // One-shot marker: `{untracked}` doubles as "awaiting capture". The engine
      // captures the post-increment generation on its next effect tick when
      // `cloudId !== null` (CAPTURE_BASELINE).
      return { ...state, baseline: untrackedBaseline() };
    case 'CAPTURE_BASELINE':
      return { ...state, baseline: cleanBaseline(action.version) };
    case 'SET_ASYNC_TRANSIENT':
      // Overlay the sync/offline transient without disturbing the op `status`;
      // the engine sets this from async callbacks and microtask-clears it.
      return { ...state, asyncTransient: action.value };
    default: {
      // Exhaustiveness guard: a later slice that adds an action without a case
      // here gets a compile error. Returns `state` unchanged at runtime.
      const _exhaustive: never = action;
      return _exhaustive ?? state;
    }
  }
}
