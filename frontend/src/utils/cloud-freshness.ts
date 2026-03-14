import type { MutableRefObject } from 'react';
import { getProject } from './api-client';
import { parseProjectData } from './cloud-project-loader';
import { patchProjectState } from './project-storage';
import { serializeState } from './storage';
import type { ImportStateAction } from '../context/app-context';
import type { InternalCloudSyncState, CloudMetadataUpdate } from '../types/cloud-sync';

export interface FreshnessCheckParams {
  cloudId: string;
  knownVersion: number;
  localId: string;
  jwt: string;
  internalRef: MutableRefObject<InternalCloudSyncState>;
  dataVersionRef: MutableRefObject<number>;
  dispatch: (action: ImportStateAction) => void;
  needsVersionSyncRef: MutableRefObject<boolean>;
  lastFreshnessCheckRef: MutableRefObject<number>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => void;
  setInternal: (updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void;
  force?: boolean;
}

const FRESHNESS_CHECK_INTERVAL = 30_000; // 30 seconds

/**
 * Check whether the server has a newer version of the project.
 * If it does and the user hasn't started editing (isDirty=false), pull the latest.
 *
 * Throttled to at most once per 30 seconds (reset on project switch).
 * Use `force: true` to bypass throttle, version check, and isDirty guard
 * (used by the Load button in the conflict banner).
 *
 * Uses a single fetch — the full project data from getProject() is parsed
 * directly via parseProjectData() to avoid a double-fetch.
 */
export async function checkAndPullFreshVersion(params: FreshnessCheckParams): Promise<void> {
  const {
    cloudId, knownVersion, localId, jwt,
    internalRef, dataVersionRef, dispatch,
    needsVersionSyncRef, lastFreshnessCheckRef,
    updateCloudMetadata, setInternal,
    force = false,
  } = params;

  // Throttle check (visibilitychange can fire rapidly)
  if (!force && Date.now() - lastFreshnessCheckRef.current < FRESHNESS_CHECK_INTERVAL) return;
  lastFreshnessCheckRef.current = Date.now();

  const serverResponse = await getProject(cloudId, jwt);
  const serverVersion = serverResponse.version ?? knownVersion;

  if (!force && serverVersion <= knownVersion) return; // Cache is fresh

  // Only update if user hasn't started editing (unless forced)
  if (!force && dataVersionRef.current !== internalRef.current.lastSavedVersion) return; // isDirty

  // Parse the data we already fetched (single-fetch pattern)
  const parsed = parseProjectData(serverResponse.data);
  if (!parsed) return; // Parse failed — keep cached version

  dispatch({
    type: 'IMPORT_STATE',
    registers: parsed.registers,
    values: parsed.values,
    project: parsed.project,
    addressUnitBits: parsed.addressUnitBits,
  });

  // Update localStorage with fresh data
  patchProjectState(localId, serializeState({
    registers: parsed.registers,
    registerValues: parsed.values,
    activeRegisterId: parsed.registers[0]?.id ?? '',
    project: parsed.project,
    addressUnitBits: parsed.addressUnitBits ?? 8,
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
  }));
  needsVersionSyncRef.current = true;

  setInternal((prev) => ({
    ...prev,
    serverVersion,
    lastCloudSavedAt: serverResponse.updatedAt,
    conflict: null,
  }));

  updateCloudMetadata(localId, {
    cloudSavedAt: serverResponse.updatedAt,
    serverVersion,
  });
}
