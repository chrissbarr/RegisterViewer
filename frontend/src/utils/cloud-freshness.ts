import type { MutableRefObject } from 'react';
import { getProject } from './api-client';
import { parseProjectData } from './cloud-project-loader';
import { patchProjectState, loadProject } from './project-storage';
import { cloudSyncReducer } from './cloud-sync-reducer';
import { serializeState, deserializeState } from './storage';
import type { ImportStateAction } from '../context/app-context';
import type { InternalCloudSyncState, CloudMetadataUpdate } from '../types/cloud-sync';
import type { ProjectStorageWriteResult } from './project-storage';

/** Stable refs and callbacks; same across all freshness check calls within a provider. */
export interface FreshnessCheckContext {
  internalRef: MutableRefObject<InternalCloudSyncState>;
  dataVersionRef: MutableRefObject<number>;
  dispatch: (action: ImportStateAction) => void;
  needsVersionSyncRef: MutableRefObject<boolean>;
  lastFreshnessCheckRef: MutableRefObject<number>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  setInternal: (updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void;
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

type FreshnessCheckResult =
  | { applied: true; serverVersion: number }
  | {
      applied: false;
      reason: 'throttled' | 'fresh' | 'dirty' | 'changed-during-pull' | 'parse-failed' | 'local-persist-failed';
      serverVersion?: number;
    };

const FRESHNESS_CHECK_INTERVAL = 30_000; // 30 seconds

/**
 * Check whether the server has a newer version of the project.
 * If it does and the user hasn't started editing (isDirty=false), pull the latest.
 *
 * Throttled to at most once per 30 seconds (reset on project switch).
 * `pull-if-clean` bypasses throttle/version checks for clean 409 recovery,
 * but still refuses to overwrite local edits. `replace-with-server` is for
 * explicit user action from the conflict UI.
 *
 * Uses a single fetch; the full project data from getProject() is parsed
 * directly via parseProjectData() to avoid a double-fetch.
 */
export async function checkAndPullFreshVersion(
  ctx: FreshnessCheckContext,
  call: FreshnessCheckCall,
): Promise<FreshnessCheckResult> {
  const {
    internalRef, dataVersionRef, dispatch,
    needsVersionSyncRef, lastFreshnessCheckRef,
    updateCloudMetadata, setInternal,
  } = ctx;
  const {
    cloudId,
    knownVersion,
    localId,
    jwt,
    mode = 'normal',
    expectedDataVersion,
  } = call;
  const bypassThrottle = mode !== 'normal';
  const bypassVersionCheck = mode !== 'normal';
  const allowDirtyOverwrite = mode === 'replace-with-server';

  // Throttle check (visibilitychange can fire rapidly).
  if (!bypassThrottle && Date.now() - lastFreshnessCheckRef.current < FRESHNESS_CHECK_INTERVAL) {
    return { applied: false, reason: 'throttled' };
  }
  lastFreshnessCheckRef.current = Date.now();

  if (!allowDirtyOverwrite && dataVersionRef.current !== internalRef.current.lastSavedVersion) {
    return { applied: false, reason: 'dirty' };
  }
  if (expectedDataVersion !== undefined && dataVersionRef.current !== expectedDataVersion) {
    return { applied: false, reason: 'changed-during-pull' };
  }

  const serverResponse = await getProject(cloudId, jwt);
  const serverVersion = serverResponse.version;

  if (!bypassVersionCheck && serverVersion <= knownVersion) {
    return { applied: false, reason: 'fresh', serverVersion };
  }

  // Re-check after the network round-trip so a new edit cannot be overwritten.
  if (!allowDirtyOverwrite && dataVersionRef.current !== internalRef.current.lastSavedVersion) {
    return { applied: false, reason: 'dirty', serverVersion };
  }
  if (expectedDataVersion !== undefined && dataVersionRef.current !== expectedDataVersion) {
    return { applied: false, reason: 'changed-during-pull', serverVersion };
  }

  const parsed = parseProjectData(serverResponse.data);
  if (!parsed) return { applied: false, reason: 'parse-failed', serverVersion };

  if (localId) {
    // Update localStorage with fresh data, preserving local-only UI fields
    // (activeRegisterId, mapTableWidth, mapShowGaps, mapSortDescending).
    // These fields are not synced to the server, so overwriting them with
    // defaults would reset the user's view preferences.
    const existingProject = loadProject(localId);
    const existingState = existingProject ? deserializeState(existingProject.state) : null;
    const persistResult = patchProjectState(localId, serializeState({
      registers: parsed.registers,
      registerValues: parsed.values,
      activeRegisterId: existingState?.activeRegisterId ?? parsed.registers[0]?.id ?? '',
      project: parsed.project,
      addressUnitBits: parsed.addressUnitBits ?? 8,
      mapTableWidth: existingState?.mapTableWidth ?? 32,
      mapShowGaps: existingState?.mapShowGaps ?? true,
      mapSortDescending: existingState?.mapSortDescending ?? false,
    }));
    if (!persistResult.ok) {
      if (import.meta.env.DEV) {
        console.warn('[cloud-freshness] Failed to persist pulled project:', localId, persistResult.status, persistResult.error);
      }
      return { applied: false, reason: 'local-persist-failed', serverVersion };
    }
    const metadataResult = updateCloudMetadata(localId, {
      cloudSavedAt: serverResponse.updatedAt,
      visibility: serverResponse.visibility,
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
  needsVersionSyncRef.current = true;

  setInternal((prev) => cloudSyncReducer(prev, {
    type: 'APPLY_PULL',
    serverVersion,
    cloudSavedAt: serverResponse.updatedAt,
    visibility: serverResponse.visibility,
  }));

  return { applied: true, serverVersion };
}
