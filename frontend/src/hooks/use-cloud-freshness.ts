import type { Dispatch, MutableRefObject } from 'react';
import { getProject } from '../utils/api-client';
import { patchProjectState, loadProject, type ProjectStorageWriteResult } from '../utils/project-storage';
import type { CloudSyncAction } from '../utils/cloud-sync-reducer';
import { deserializeState } from '../utils/storage';
import { materializeCloudProject } from '../utils/cloud-materialize';
import { decideFreshnessPull, type FreshnessCheckCall } from '../utils/cloud-freshness';
import type { ImportStateAction } from '../context/app-context';
import type { InternalCloudSyncState, CloudMetadataUpdate } from '../types/cloud-sync';

/** Stable refs and callbacks; same across all freshness check calls within a provider. */
export interface FreshnessCheckContext {
  internalRef: MutableRefObject<InternalCloudSyncState>;
  dataVersionRef: MutableRefObject<number>;
  /** App-context dispatch (IMPORT_STATE). */
  dispatch: (action: ImportStateAction) => void;
  lastFreshnessCheckRef: MutableRefObject<number>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  /** Cloud-sync reducer dispatch (REQUEST_BASELINE / APPLY_PULL). */
  cloudDispatch: Dispatch<CloudSyncAction>;
}

type FreshnessCheckResult =
  | { applied: true; serverVersion: number }
  | {
      applied: false;
      reason: 'throttled' | 'fresh' | 'dirty' | 'changed-during-pull' | 'parse-failed' | 'local-persist-failed';
      serverVersion?: number;
    };

/**
 * Effectful freshness shim. Owns ALL side effects (network fetch, throttle
 * timestamp write, localStorage persist, dispatch, internal-state mutation) and
 * delegates every gate/decision to the pure `decideFreshnessPull` core.
 *
 * Check whether the server has a newer version of the project. If it does and
 * the user hasn't started editing (isDirty=false), pull the latest.
 *
 * Throttled to at most once per 30 seconds (reset on project switch).
 * `pull-if-clean` bypasses throttle/version checks for clean 409 recovery,
 * but still refuses to overwrite local edits. `replace-with-server` is for
 * explicit user action from the conflict UI.
 *
 * Uses a single fetch; the full project data from getProject() is parsed
 * directly via parseProjectData() (inside the pure core) to avoid a double-fetch.
 *
 * The pure core is called twice — once for the pre-fetch gate and once
 * post-fetch — so the two-phase dirty re-check timing is preserved exactly.
 */
export async function checkAndPullFreshVersion(
  ctx: FreshnessCheckContext,
  call: FreshnessCheckCall,
): Promise<FreshnessCheckResult> {
  const {
    internalRef, dataVersionRef, dispatch,
    lastFreshnessCheckRef,
    updateCloudMetadata, cloudDispatch,
  } = ctx;
  const { cloudId, localId, jwt } = call;

  // Pre-fetch gate (throttle + dirty / changed-during-pull re-check #1).
  const preDecision = decideFreshnessPull(
    {
      now: Date.now(),
      lastCheck: lastFreshnessCheckRef.current,
      dataVersion: dataVersionRef.current,
      baseline: internalRef.current.baseline,
    },
    call,
  );
  if (preDecision && preDecision.kind === 'throttled') {
    return { applied: false, reason: 'throttled' };
  }
  // Record the check timestamp once we are past the throttle gate (matches the
  // original timing: the timestamp advances even when the project is dirty).
  lastFreshnessCheckRef.current = Date.now();
  if (preDecision && preDecision.kind === 'dirty') {
    return { applied: false, reason: 'dirty' };
  }
  if (preDecision && preDecision.kind === 'changed-during-pull') {
    return { applied: false, reason: 'changed-during-pull' };
  }

  const serverResponse = await getProject(cloudId, jwt);

  // Post-fetch decision (version compare + dirty / changed-during-pull
  // re-check #2 + parse).
  const decision = decideFreshnessPull(
    {
      now: Date.now(),
      lastCheck: lastFreshnessCheckRef.current,
      dataVersion: dataVersionRef.current,
      baseline: internalRef.current.baseline,
    },
    call,
    serverResponse,
  );

  // `decision` is always terminal post-fetch (serverResponse provided); the
  // pure core never returns null/throttled/local-persist-failed here, but
  // narrow exhaustively for type-safety.
  if (!decision) return { applied: false, reason: 'fresh' };
  if (decision.kind === 'throttled') return { applied: false, reason: 'fresh' };
  if (decision.kind === 'fresh') {
    return { applied: false, reason: 'fresh', serverVersion: decision.serverVersion };
  }
  if (decision.kind === 'dirty') {
    return { applied: false, reason: 'dirty', serverVersion: decision.serverVersion };
  }
  if (decision.kind === 'changed-during-pull') {
    return { applied: false, reason: 'changed-during-pull', serverVersion: decision.serverVersion };
  }
  if (decision.kind === 'parse-failed') {
    return { applied: false, reason: 'parse-failed', serverVersion: decision.serverVersion };
  }
  if (decision.kind === 'local-persist-failed') {
    return { applied: false, reason: 'local-persist-failed', serverVersion: decision.serverVersion };
  }

  const { serverVersion, cloudSavedAt, visibility, importPayload: parsed } = decision;

  if (localId) {
    // P4 — `merge`: update localStorage with fresh server data while preserving
    // local-only UI fields (activeRegisterId, mapTableWidth, mapShowGaps,
    // mapSortDescending). These fields are not synced to the server, so
    // overwriting them with defaults would reset the user's view preferences.
    // This is the ONLY persist path that preserves UI fields.
    let persistStatus = '';
    let persistError: unknown;
    const { persisted } = materializeCloudProject({
      writeMode: 'merge',
      localId,
      cloudId,
      importResult: parsed,
      callbacks: {
        loadExistingState: (id) => {
          const existingProject = loadProject(id);
          return existingProject ? deserializeState(existingProject.state) : null;
        },
        persist: (serialized) => {
          const persistResult = patchProjectState(localId, serialized);
          persistStatus = persistResult.status;
          persistError = persistResult.error;
          return persistResult.ok;
        },
      },
    });
    if (!persisted) {
      if (import.meta.env.DEV) {
        console.warn('[cloud-freshness] Failed to persist pulled project:', localId, persistStatus, persistError);
      }
      return { applied: false, reason: 'local-persist-failed', serverVersion };
    }
    const metadataResult = updateCloudMetadata(localId, {
      cloudSavedAt,
      visibility,
      serverVersion,
      cloudConflictVersion: null,
      hasUnsyncedChanges: false,
    });
    if (!metadataResult.ok) {
      if (import.meta.env.DEV) {
        console.warn('[cloud-freshness] Failed to persist pulled project metadata:', localId, metadataResult.status, metadataResult.error);
      }
      return { applied: false, reason: 'local-persist-failed', serverVersion };
    }
  }

  dispatch({
    type: 'IMPORT_STATE',
    registers: parsed.registers,
    values: parsed.values,
    project: parsed.project,
    addressUnitBits: parsed.addressUnitBits,
  });
  // Mark "awaiting baseline capture" (baseline → {untracked}) so the engine
  // snapshots the new generation into a clean baseline on its next effect tick
  // (replaces needsVersionSyncRef).
  cloudDispatch({ type: 'REQUEST_BASELINE' });

  cloudDispatch({
    type: 'APPLY_PULL',
    serverVersion,
    cloudSavedAt,
    visibility,
  });

  return { applied: true, serverVersion };
}
