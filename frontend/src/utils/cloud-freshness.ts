import { parseProjectData } from './cloud-project-loader';
import type { ImportResult } from './storage';
import type { GetProjectResponse } from './api-client';
import type { Visibility } from '../types/project';
import type { Baseline } from '../types/cloud-sync';

/**
 * Primitive inputs the pure freshness decision reads. The effectful shim
 * (`use-cloud-freshness.ts`) snapshots these off its refs/state before each
 * call so the decision logic stays free of React/context dependencies.
 */
export interface FreshnessDecisionState {
  /** Current time (ms). The shim passes `Date.now()`. */
  now: number;
  /** Timestamp of the last freshness check (ms); used for the throttle gate. */
  lastCheck: number;
  /** Current data generation counter (`dataVersionRef.current`). */
  dataVersion: number;
  /** Save baseline the data is compared against for dirtiness (S14a). */
  baseline: Baseline;
  /** Cloud id of the LIVE active project (`internalRef.current.cloudId`); BR-3 identity gate. */
  liveCloudId: string | null;
  /** Local id of the LIVE active project (`activeLocalIdRef.current`); BR-3 identity gate. */
  liveLocalId: string | null;
}

/**
 * Reproduces the former `dataVersion !== lastSavedVersion` freshness dirty check
 * over the `baseline` union (S14a): a `clean` baseline is dirty iff the
 * generation drifted; `dirty`/`untracked` baselines (former MAX_SAFE_INTEGER/-1
 * sentinels) are always treated as dirty. NOTE: unlike the engine's `isDirty`,
 * this has NO `cloudId` guard and counts `untracked` as dirty — preserving the
 * freshness gate's original "block the pull whenever generations differ"
 * semantics byte-for-byte.
 */
function baselineDirty(baseline: Baseline, dataVersion: number): boolean {
  return baseline.kind !== 'clean' || dataVersion !== baseline.version;
}

/**
 * BR-3 identity gate: true when the active project is no longer the one this
 * check was started for (the user switched projects while the check was
 * queued or its fetch was in flight). Without this gate a stale pull would
 * IMPORT_STATE the departed project's payload into the NEW project's live
 * workspace, and APPLY_PULL would stamp the departed project's cloud metadata
 * onto it. Identity is orthogonal to `allowDirtyOverwrite`, so the gate runs
 * in ALL modes — including `replace-with-server`, which bypasses even the
 * dirty gate.
 *
 * Null semantics: an absent `call.localId` (undefined or null) matches a null
 * live localId, so the unsaved shared-project viewer keeps pulling; same
 * localId + same cloudId always passes (A→A re-init).
 *
 * Reducer-level `ifCloudId` hardening for APPLY_PULL / SET_CONFLICT is a
 * deliberate follow-up (it interacts with the engine's baseline-capture
 * flow); this pure-core gate is the BR-3 fix proper.
 */
function switchedProject(state: FreshnessDecisionState, call: FreshnessCheckCall): boolean {
  return state.liveCloudId !== call.cloudId
    || state.liveLocalId !== (call.localId ?? null);
}

/** Per-call parameters that vary on each invocation. */
export interface FreshnessCheckCall {
  cloudId: string;
  knownVersion: number;
  localId?: string | null;
  jwt: string;
  mode?: 'normal' | 'pull-if-clean' | 'replace-with-server';
  expectedDataVersion?: number;
}

/**
 * The discriminated decision returned by `decideFreshnessPull`. Non-`pull`
 * kinds are terminal "do not pull" outcomes; `pull` carries the parsed payload
 * and the metadata the shim applies.
 */
type FreshnessDecision =
  | { kind: 'throttled' }
  | { kind: 'dirty'; serverVersion?: number }
  | { kind: 'fresh'; serverVersion: number }
  | { kind: 'changed-during-pull'; serverVersion?: number }
  | { kind: 'parse-failed'; serverVersion: number }
  | { kind: 'local-persist-failed'; serverVersion: number }
  | {
      kind: 'switched-project';
      /**
       * The payload fields are present post-fetch only (after a successful
       * parse): the live-context apply is refused, but the shim still
       * completes the persist keyed to the CAPTURED `call.localId` so the
       * departed project's record and manifest stay consistent (BR-3).
       */
      serverVersion?: number;
      cloudSavedAt?: string;
      visibility?: Visibility;
      importPayload?: ImportResult;
    }
  | {
      kind: 'pull';
      serverVersion: number;
      cloudSavedAt: string;
      visibility: Visibility;
      importPayload: ImportResult;
    };

const FRESHNESS_CHECK_INTERVAL = 30_000; // 30 seconds

/**
 * Pure decision for the lightweight `/meta` probe (P6, `'normal'` mode only):
 * the cache is fresh — the shim skips the full payload fetch — when the
 * server version has not advanced past the known version. Mirrors the
 * post-fetch `serverVersion <= knownVersion` compare in `decideFreshnessPull`.
 */
export function probeIndicatesFresh(probeVersion: number, knownVersion: number): boolean {
  return probeVersion <= knownVersion;
}

/**
 * Pure freshness decision. Mirrors the `cloud-sync.ts` pure-core pattern: no
 * React/context imports, fed entirely by primitive inputs.
 *
 * Called twice by the shim to preserve the original two-phase timing:
 *
 * 1. **Pre-fetch** (`serverResponse` omitted): runs the throttle gate and the
 *    pre-fetch identity / dirty / changed-during-pull re-checks. Returns a
 *    blocking decision when one fires, or `null` to signal "proceed to the
 *    network fetch". (`now`/`lastCheck` only matter here.)
 * 2. **Post-fetch** (`serverResponse` provided): runs the version compare and
 *    the SAME identity / dirty / changed-during-pull re-checks against the
 *    now-current live state, then parses the payload. Always returns a
 *    terminal decision (`fresh` | `switched-project` | `dirty` |
 *    `changed-during-pull` | `parse-failed` | `pull`).
 *
 * The two-phase dirty re-check (before AND after the fetch) is what prevents a
 * new local edit landing mid-fetch from being silently overwritten.
 */
export function decideFreshnessPull(
  state: FreshnessDecisionState,
  call: FreshnessCheckCall,
  serverResponse?: GetProjectResponse,
): FreshnessDecision | null {
  const { now, lastCheck, dataVersion, baseline } = state;
  const { knownVersion, mode = 'normal', expectedDataVersion } = call;
  const bypassThrottle = mode !== 'normal';
  const bypassVersionCheck = mode !== 'normal';
  const allowDirtyOverwrite = mode === 'replace-with-server';

  if (serverResponse === undefined) {
    // ── Pre-fetch gate ──────────────────────────────────────────────────
    // Throttle check (visibilitychange can fire rapidly).
    if (!bypassThrottle && now - lastCheck < FRESHNESS_CHECK_INTERVAL) {
      return { kind: 'throttled' };
    }
    // BR-3 identity gate (all modes) — refuse a check for a project that is
    // no longer active before the probe/GET round trips are paid.
    if (switchedProject(state, call)) {
      return { kind: 'switched-project' };
    }
    if (!allowDirtyOverwrite && baselineDirty(baseline, dataVersion)) {
      return { kind: 'dirty' };
    }
    if (expectedDataVersion !== undefined && dataVersion !== expectedDataVersion) {
      return { kind: 'changed-during-pull' };
    }
    // No blocking gate — proceed to the network fetch.
    return null;
  }

  // ── Post-fetch decision ───────────────────────────────────────────────
  const serverVersion = serverResponse.version;

  if (!bypassVersionCheck && serverVersion <= knownVersion) {
    return { kind: 'fresh', serverVersion };
  }

  // BR-3 identity gate (re-check #2): the switch may land mid-fetch. Runs
  // BEFORE the dirty / changed-during-pull gates — those read the NEW
  // project's live baseline, which is meaningless for the departed call (a
  // clean new project would otherwise let the stale pull through; in
  // `replace-with-server` mode even a DIRTY one would). Parse first so the
  // decision still carries the payload for the captured-localId persist.
  if (switchedProject(state, call)) {
    const parsed = parseProjectData(serverResponse.data);
    if (!parsed) return { kind: 'parse-failed', serverVersion };
    return {
      kind: 'switched-project',
      serverVersion,
      cloudSavedAt: serverResponse.updatedAt,
      visibility: serverResponse.visibility,
      importPayload: parsed,
    };
  }

  // Re-check after the network round-trip so a new edit cannot be overwritten.
  if (!allowDirtyOverwrite && baselineDirty(baseline, dataVersion)) {
    return { kind: 'dirty', serverVersion };
  }
  if (expectedDataVersion !== undefined && dataVersion !== expectedDataVersion) {
    return { kind: 'changed-during-pull', serverVersion };
  }

  const parsed = parseProjectData(serverResponse.data);
  if (!parsed) return { kind: 'parse-failed', serverVersion };

  return {
    kind: 'pull',
    serverVersion,
    cloudSavedAt: serverResponse.updatedAt,
    visibility: serverResponse.visibility,
    importPayload: parsed,
  };
}
