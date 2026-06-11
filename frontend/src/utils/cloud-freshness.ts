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
 *    pre-fetch dirty / changed-during-pull re-checks. Returns a blocking
 *    decision when one fires, or `null` to signal "proceed to the network
 *    fetch". (`now`/`lastCheck` only matter here.)
 * 2. **Post-fetch** (`serverResponse` provided): runs the version compare and
 *    the SAME dirty / changed-during-pull re-checks against the now-current
 *    `dataVersion`, then parses the payload. Always returns a terminal
 *    decision (`fresh` | `dirty` | `changed-during-pull` | `parse-failed` |
 *    `pull`).
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
