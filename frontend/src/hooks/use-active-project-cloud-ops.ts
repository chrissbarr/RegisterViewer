import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { exportToObject, serializeImportResult, serializeState } from '../utils/storage';
import { isCloudEnabled, ApiError } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { checkAndPullFreshVersion, type FreshnessCheckContext } from '../utils/cloud-freshness';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { buildProjectUrl, patchProjectState, type ProjectStorageWriteResult } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock, requireJwt } from '../utils/cloud-utils';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl, type SaveConflictResult } from '../utils/cloud-operations';
import { positiveVersion } from '../utils/cloud-sync';
import { DEFAULT_PROJECT_NAME, type Visibility } from '../types/project';
import type { AppState } from '../types/register';
import { type CloudSyncCore, type CloudMetadataUpdate, type InternalCloudSyncState, type SaveOutcome, initialInternalState } from '../types/cloud-sync';
import type { ImportStateAction } from '../context/app-context';

interface ConflictHandlerParams {
  result: SaveConflictResult;
  attempt: SaveAttemptSnapshot;
  dataVersionRef: MutableRefObject<number>;
  capturedLocalId: string | null;
  existingCloudId: string | null;
  activeLocalIdRef: MutableRefObject<string | null>;
  internalRef: MutableRefObject<InternalCloudSyncState>;
  lastFreshnessCheckRef: MutableRefObject<number>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  appStateRef: MutableRefObject<AppState>;
  setInternal: (updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void;
  dispatch: (action: ImportStateAction) => void;
  getJwt: () => string | null;
}

interface SaveAttemptSnapshot {
  dataVersion: number;
  lastSavedVersion: number;
  serverVersion: number;
}

/**
 * Returns true only when the save's captured context still matches the current
 * active project AND the cloud project has not changed.
 *
 * After sign-out (or delete/unlink/switch) resets cloud state,
 * `internalRef.current.cloudId` no longer matches the save's captured cloudId,
 * so late completions (401/409/success) skip their `setInternal` writes and
 * cannot paint stale errors/conflicts onto the reset cloud state.
 *
 * For a save that CREATES a new cloud project, both `expectedCloudId` and
 * `internalRef.current.cloudId` start as null — the `null === null` comparison
 * holds throughout the POST, so `applyCreatedResult` still runs correctly.
 */
function isSameActiveSaveTarget(
  capturedLocalId: string | null,
  expectedCloudId: string | null,
  activeLocalIdRef: MutableRefObject<string | null>,
  internalRef: MutableRefObject<InternalCloudSyncState>,
): boolean {
  if (capturedLocalId !== null) {
    return activeLocalIdRef.current === capturedLocalId
      && internalRef.current.cloudId === expectedCloudId;
  }
  return activeLocalIdRef.current === null
    && internalRef.current.cloudId === expectedCloudId;
}

interface NotFoundHandlerParams {
  capturedLocalId: string | null;
  stillOnSameProject: boolean;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  setInternal: (updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void;
}

function handleNotFoundResultImpl(params: NotFoundHandlerParams): SaveOutcome {
  const { capturedLocalId, stillOnSameProject, updateCloudMetadata, setInternal } = params;

  if (capturedLocalId) {
    const metadataResult = updateCloudMetadata(capturedLocalId, CLEARED_CLOUD_METADATA);
    if (!metadataResult.ok) {
      if (stillOnSameProject) {
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          error: 'Cloud project was deleted on the server, but local cloud metadata could not be updated.',
        }));
      }
      return 'not-found';
    }
  }
  if (stillOnSameProject) {
    clearCloudUrl();
    setInternal((prev) => ({
      ...prev,
      cloudId: null,
      isOwner: false,
      status: 'idle',
      shareUrl: null,
      lastCloudSavedAt: null,
      visibility: 'private',
      error: 'Cloud project not found. It may have been deleted. Use "Save to Cloud" to create a new copy.',
    }));
  }
  return 'not-found';
}

interface UpdatedHandlerParams {
  result: { kind: 'updated'; version: number; timestamp: string };
  attempt: SaveAttemptSnapshot;
  capturedLocalId: string | null;
  stillOnSameProject: boolean;
  editedDuringSave: boolean;
  activeLocalIdRef: MutableRefObject<string | null>;
  internalRef: MutableRefObject<InternalCloudSyncState>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  appStateRef: MutableRefObject<AppState>;
  setInternal: (updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void;
}

function handleUpdatedResultImpl(params: UpdatedHandlerParams): SaveOutcome {
  const {
    result, attempt, capturedLocalId, stillOnSameProject, editedDuringSave,
    activeLocalIdRef, internalRef, updateCloudMetadata, appStateRef, setInternal,
  } = params;

  // Record the new server version immediately so a later retry reads the
  // confirmed version and cannot re-PUT a stale version.
  if (stillOnSameProject) {
    internalRef.current = { ...internalRef.current, serverVersion: result.version };
    setInternal((prev) => ({ ...prev, serverVersion: result.version }));
  }
  if (capturedLocalId) {
    let persistError: string | null = null;

    const stateResult = patchProjectState(capturedLocalId, serializeState(appStateRef.current), {
      protectedLocalIds: [activeLocalIdRef.current],
    });
    if (!stateResult.ok) {
      persistError = 'Project was saved to cloud, but the local copy could not be updated.';
    } else {
      const metadataResult = updateCloudMetadata(capturedLocalId, {
        cloudSavedAt: result.timestamp,
        serverVersion: result.version,
        cloudConflictVersion: null,
        hasUnsyncedChanges: editedDuringSave,
      });
      if (!metadataResult.ok) {
        persistError = 'Project was saved to cloud, but local cloud metadata could not be persisted.';
      }
    }

    if (persistError !== null) {
      if (stillOnSameProject) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: persistError }));
      }
      // Best-effort: persist the confirmed server version to the manifest so
      // later readers (e.g. the departure save) can't re-PUT a stale version
      // and manufacture a 409. Ignore the result — we're already failing.
      updateCloudMetadata(capturedLocalId, { serverVersion: result.version });
      return 'local-persist-failed';
    }
  }
  if (stillOnSameProject) {
    setInternal((prev) => ({
      ...prev,
      status: 'idle',
      lastCloudSavedAt: result.timestamp,
      lastSavedVersion: attempt.dataVersion,
      serverVersion: result.version,
      conflict: null,
    }));
  }
  return 'saved';
}

async function handleConflictResult(params: ConflictHandlerParams): Promise<void> {
  const {
    result, attempt, dataVersionRef, capturedLocalId, existingCloudId,
    activeLocalIdRef, internalRef, lastFreshnessCheckRef, needsVersionSyncRef,
    updateCloudMetadata, appStateRef, setInternal, dispatch, getJwt,
  } = params;

  const dirtyAtSaveStart = attempt.dataVersion !== attempt.lastSavedVersion;
  const editedDuringSave = dataVersionRef.current !== attempt.dataVersion;
  const stillOnSameProject = isSameActiveSaveTarget(
    capturedLocalId,
    existingCloudId,
    activeLocalIdRef,
    internalRef,
  );

  if (dirtyAtSaveStart || editedDuringSave) {
    if (capturedLocalId) {
      const stateResult = patchProjectState(capturedLocalId, serializeState(appStateRef.current), {
        protectedLocalIds: [activeLocalIdRef.current],
      });
      if (stateResult.ok) {
        updateCloudMetadata(capturedLocalId, {
          serverVersion: result.serverVersion,
          cloudConflictVersion: result.serverVersion,
          hasUnsyncedChanges: true,
        });
      }
    }
    if (!stillOnSameProject) return;
    // Dirty 409: preserve local edits and wait for explicit user action.
    setInternal((prev) => ({
      ...prev,
      status: 'idle',
      serverVersion: result.serverVersion,
      conflict: { serverVersion: result.serverVersion },
    }));
    return;
  }

  if (!stillOnSameProject) return;

  // Clean 409: no local edits; pull server version silently unless a new edit appears.
  setInternal((prev) => ({
    ...prev,
    status: 'idle',
    serverVersion: result.serverVersion,
  }));

  try {
    const freshJwt = getJwt();
    if (!freshJwt || !existingCloudId) {
      setInternal((prev) => ({
        ...prev,
        conflict: { serverVersion: result.serverVersion },
      }));
      return;
    }

    const freshnessCtx: FreshnessCheckContext = {
      internalRef, dataVersionRef, dispatch, needsVersionSyncRef,
      lastFreshnessCheckRef, updateCloudMetadata, setInternal,
    };
    const pullResult = await checkAndPullFreshVersion(freshnessCtx, {
      cloudId: existingCloudId,
      knownVersion: 0,
      localId: capturedLocalId,
      jwt: freshJwt,
      mode: 'pull-if-clean',
      expectedDataVersion: attempt.dataVersion,
    });
    if (!pullResult.applied) {
      setInternal((prev) => ({
        ...prev,
        conflict: { serverVersion: result.serverVersion },
      }));
    }
  } catch {
    // Pull failed — show conflict UX as fallback
    if (isSameActiveSaveTarget(capturedLocalId, existingCloudId, activeLocalIdRef, internalRef)) {
      setInternal((prev) => ({
        ...prev,
        conflict: { serverVersion: result.serverVersion },
      }));
    }
  }
}

interface ActiveProjectCloudOpsDeps {
  core: CloudSyncCore;
  appStateRef: MutableRefObject<AppState>;
  dataVersionRef: MutableRefObject<number>;
  mutationLockRef: MutableRefObject<boolean>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  lastFreshnessCheckRef: MutableRefObject<number>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => ProjectStorageWriteResult;
  createNewProject: (name: string, state: ReturnType<typeof serializeState>) => string | null;
  loadAsUnsaved: (result: Awaited<ReturnType<typeof fetchAndParseCloudProject>>, name: string, source: 'cloud') => boolean;
  getJwt: () => string | null;
  dispatch: Dispatch<ImportStateAction>;
}

interface ActiveProjectCloudOps {
  saveToCloud: () => Promise<SaveOutcome>;
  fork: () => Promise<void>;
  deleteFromCloud: () => Promise<void>;
  setVisibility: (v: Visibility) => Promise<void>;
  loadCloudProject: (cloudId: string) => Promise<void>;
  loginRequired: boolean;
  pendingOpRef: MutableRefObject<'save' | 'fork' | null>;
  dismissLogin: () => void;
}

/**
 * Cloud operations for the currently active project.
 *
 * Extracted from CloudSyncProvider to reduce its cognitive complexity.
 * All operations read latest state via refs (not direct state) to keep
 * callback references stable across renders.
 *
 * Includes inline JWT guard (absorbed from the former useLoginGuard):
 * when no JWT is available, stores the pending operation type and sets
 * `loginRequired` to trigger the login dialog. After login, the
 * auth-transition effect retries the operation via `pendingOpRef`.
 */
export function useActiveProjectCloudOps(deps: ActiveProjectCloudOpsDeps): ActiveProjectCloudOps {
  const {
    core: { internalRef, activeLocalIdRef, setInternal },
    appStateRef, dataVersionRef, mutationLockRef, needsVersionSyncRef, lastFreshnessCheckRef,
    updateCloudMetadata, createNewProject, loadAsUnsaved, getJwt, dispatch,
  } = deps;

  // Login guard state (absorbed from useLoginGuard)
  const [loginRequired, setLoginRequired] = useState(false);
  const pendingOpRef = useRef<'save' | 'fork' | null>(null);

  const dismissLogin = useCallback(() => {
    setLoginRequired(false);
    pendingOpRef.current = null;
  }, []);

  const applyCreatedResult = useCallback((
    result: { cloudId: string; timestamp: string; version: number },
    savedDataVersion: number,
    hasUnsyncedChanges: boolean,
  ): SaveOutcome => {
    let currentLocalId = activeLocalIdRef.current;

    // When forking a shared project, no local project exists yet — create one
    if (!currentLocalId) {
      const serialized = serializeState(appStateRef.current);
      const name = appStateRef.current.project?.title ?? DEFAULT_PROJECT_NAME;
      currentLocalId = createNewProject(name, serialized);
      if (!currentLocalId) {
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          error: 'Project was saved to cloud, but local project metadata could not be persisted.',
        }));
        return 'local-persist-failed';
      }
    } else {
      const stateResult = patchProjectState(currentLocalId, serializeState(appStateRef.current), {
        protectedLocalIds: [activeLocalIdRef.current],
      });
      if (!stateResult.ok) {
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          error: 'Project was saved to cloud, but the local copy could not be updated.',
        }));
        return 'local-persist-failed';
      }
    }

    const metadataResult = updateCloudMetadata(currentLocalId, {
      cloudId: result.cloudId,
      cloudSavedAt: result.timestamp,
      storage: 'cloud',
      serverVersion: result.version,
      cloudConflictVersion: null,
      hasUnsyncedChanges,
    });
    if (!metadataResult.ok) {
      setInternal((prev) => ({
        ...prev,
        status: 'idle',
        error: 'Project was saved to cloud, but local cloud metadata could not be persisted.',
      }));
      return 'local-persist-failed';
    }

    const shareUrl = buildProjectUrl(result.cloudId);
    setCloudUrl(result.cloudId);

    setInternal((prev) => ({
      ...prev,
      cloudId: result.cloudId,
      isOwner: true,
      storage: 'cloud',
      status: 'idle',
      shareUrl,
      lastCloudSavedAt: result.timestamp,
      lastSavedVersion: savedDataVersion,
      serverVersion: result.version,
      conflict: null,
    }));
    return 'created';
  }, [updateCloudMetadata, createNewProject, activeLocalIdRef, appStateRef, setInternal]);

  const saveToCloud = useCallback(async (): Promise<SaveOutcome> => {
    if (!isCloudEnabled()) return 'noop';

    // JWT guard: defer to login dialog if not authenticated
    const jwt = getJwt();
    if (!jwt) {
      setLoginRequired(true);
      pendingOpRef.current = 'save';
      return 'login-required';
    }

    const lockResult = await withMutationLock(mutationLockRef, async () => {
      const capturedLocalId = activeLocalIdRef.current;
      let existingCloudId: string | null = null;
      try {
        const { cloudId, isOwner, serverVersion, lastSavedVersion } = internalRef.current;
        existingCloudId = (cloudId && isOwner) ? cloudId : null;

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const attempt: SaveAttemptSnapshot = {
          dataVersion: dataVersionRef.current,
          lastSavedVersion,
          serverVersion,
        };
        const jsonPayload = exportToObject(appStateRef.current);
        const freshJwt = requireJwt(getJwt);
        const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, freshJwt, positiveVersion(serverVersion) ?? undefined);
        const editedDuringSave = dataVersionRef.current !== attempt.dataVersion;

        const stillOnSameProject = isSameActiveSaveTarget(
          capturedLocalId,
          existingCloudId,
          activeLocalIdRef,
          internalRef,
        );

        if (result.kind === 'not-found') {
          return handleNotFoundResultImpl({
            capturedLocalId, stillOnSameProject, updateCloudMetadata, setInternal,
          });
        }

        if (result.kind === 'conflict') {
          await handleConflictResult({
            result, attempt, dataVersionRef, capturedLocalId, existingCloudId,
            activeLocalIdRef, internalRef, lastFreshnessCheckRef, needsVersionSyncRef,
            updateCloudMetadata, appStateRef, setInternal, dispatch, getJwt,
          });
          return 'conflict';
        }

        if (result.kind === 'created') {
          if (stillOnSameProject) {
            return applyCreatedResult(result, attempt.dataVersion, editedDuringSave);
          }
          return 'created';
        } else {
          return handleUpdatedResultImpl({
            result, attempt, capturedLocalId, stillOnSameProject, editedDuringSave,
            activeLocalIdRef, internalRef, updateCloudMetadata, appStateRef, setInternal,
          });
        }
      } catch (err) {
        if (isSameActiveSaveTarget(capturedLocalId, existingCloudId, activeLocalIdRef, internalRef)) {
          const next = { ...internalRef.current, status: 'idle' as const, error: friendlyErrorMessage(err, 'Failed to save project.') };
          internalRef.current = next;
          setInternal(next);
        }
        throw err;
      }
    });
    return lockResult.executed ? lockResult.result : 'lock-held';
  }, [updateCloudMetadata, applyCreatedResult, mutationLockRef, dataVersionRef, getJwt, internalRef, appStateRef, activeLocalIdRef, setInternal, dispatch, needsVersionSyncRef, lastFreshnessCheckRef]);

  const fork = useCallback(async () => {
    if (!isCloudEnabled()) return;

    // JWT guard: defer to login dialog if not authenticated
    const jwt = getJwt();
    if (!jwt) {
      setLoginRequired(true);
      pendingOpRef.current = 'fork';
      return;
    }

    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
      try {
        const attemptDataVersion = dataVersionRef.current;
        const jsonPayload = exportToObject(appStateRef.current);
        const freshJwt = requireJwt(getJwt);
        const result = await saveProjectToCloudImpl(jsonPayload, null, freshJwt);
        if (result.kind !== 'created') throw new Error('Failed to save copy.');
        applyCreatedResult(result, attemptDataVersion, dataVersionRef.current !== attemptDataVersion);
      } catch (err) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: friendlyErrorMessage(err, 'Failed to save copy.') }));
      }
    });
  }, [applyCreatedResult, mutationLockRef, dataVersionRef, getJwt, appStateRef, setInternal]);

  const deleteFromCloud = useCallback(async () => {
    const { cloudId, isOwner, storage } = internalRef.current;
    if (!cloudId || !isOwner || storage !== 'cloud') return;
    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'deleting', error: null }));
      try {
        const jwt = requireJwt(getJwt);
        await deleteProjectFromCloudImpl(cloudId, jwt);

        const currentLocalId = activeLocalIdRef.current;
        if (currentLocalId) {
          const metadataResult = updateCloudMetadata(currentLocalId, CLEARED_CLOUD_METADATA);
          if (!metadataResult.ok) {
            setInternal((prev) => ({
              ...prev,
              status: 'idle',
              error: 'Cloud project was deleted, but local cloud metadata could not be updated.',
            }));
            return;
          }
        }

        clearCloudUrl();
        setInternal(initialInternalState);
      } catch (err) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: friendlyErrorMessage(err, 'Failed to delete project.') }));
      }
    });
  }, [updateCloudMetadata, mutationLockRef, getJwt, internalRef, activeLocalIdRef, setInternal]);

  const setVisibility = useCallback(async (v: Visibility) => {
    const { cloudId, isOwner, visibility: previousVisibility } = internalRef.current;
    setInternal((prev) => ({ ...prev, visibility: v }));

    if (cloudId && isOwner) {
      try {
        const jwt = requireJwt(getJwt);
        // A visibility PATCH advances the server's updated_at without bumping
        // version; persist the returned updatedAt so local cloudSavedAt tracks it
        // immediately rather than waiting for the next LIST sync.
        const updatedAt = await patchVisibilityImpl(cloudId, v, jwt);

        const currentLocalId = activeLocalIdRef.current;
        if (currentLocalId) {
          const metadataResult = updateCloudMetadata(currentLocalId, { visibility: v, cloudSavedAt: updatedAt });
          if (!metadataResult.ok) {
            setInternal((prev) => ({
              ...prev,
              visibility: previousVisibility,
              error: 'Visibility changed on server, but local metadata could not be updated.',
            }));
          }
        }
      } catch (err) {
        // Revert on failure and show error
        setInternal((prev) => ({
          ...prev,
          visibility: previousVisibility,
          error: friendlyErrorMessage(err, 'Failed to update visibility.'),
        }));
      }
    }
  }, [updateCloudMetadata, getJwt, internalRef, activeLocalIdRef, setInternal]);

  const loadCloudProject = useCallback(
    async (cloudId: string) => {
      setInternal((prev) => ({ ...prev, status: 'loading', error: null, cloudId }));
      try {
        // JWT is intentionally optional — unauthenticated users can load public/unlisted projects
        const jwt = getJwt();
        const importResult = await fetchAndParseCloudProject(cloudId, jwt ?? undefined);
        const isOwner = importResult.isOwner;
        const name = importResult.project?.title?.trim() || DEFAULT_PROJECT_NAME;
        const shareUrl = buildProjectUrl(cloudId);

        if (isOwner) {
          const localId = createNewProject(name, serializeImportResult(importResult));
          if (!localId) {
            setInternal((prev) => ({
              ...prev,
              status: 'idle',
              error: 'Cloud project loaded, but the local workspace could not be created.',
            }));
            return;
          }
          activeLocalIdRef.current = localId;
          const metadataResult = updateCloudMetadata(localId, {
            cloudId,
            storage: 'cloud',
            cloudSavedAt: importResult.updatedAt,
            visibility: importResult.visibility,
            serverVersion: importResult.version,
            cloudConflictVersion: null,
            hasUnsyncedChanges: false,
          });
          if (!metadataResult.ok) {
            setInternal((prev) => ({
              ...prev,
              status: 'idle',
              error: 'Cloud project loaded, but local cloud metadata could not be persisted.',
            }));
            return;
          }
          dispatch({
            type: 'IMPORT_STATE',
            registers: importResult.registers,
            values: importResult.values,
            project: importResult.project,
            addressUnitBits: importResult.addressUnitBits,
          });
        } else if (!loadAsUnsaved(importResult, name, 'cloud')) {
          setInternal((prev) => ({
            ...prev,
            status: 'idle',
            error: 'Cloud project loaded, but the unsaved workspace could not be created.',
          }));
          return;
        }

        // Signal the version-tracking useEffect to capture lastSavedVersion
        needsVersionSyncRef.current = true;

        setInternal((prev) => ({
          ...prev,
          cloudId,
          isOwner,
          storage: isOwner ? 'cloud' : 'local',
          status: 'idle',
          shareUrl,
          lastCloudSavedAt: importResult.updatedAt,
          serverVersion: importResult.version,
          visibility: importResult.visibility,
        }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          setInternal((prev) => ({
            ...prev,
            status: 'idle',
            error: 'Project not found \u2014 it may have been deleted.',
            cloudId: null,
          }));
          return;
        }
        setInternal((prev) => ({
          ...prev,
          status: 'idle',
          error: friendlyErrorMessage(err, 'Failed to load project.'),
        }));
      }
    },
    [activeLocalIdRef, createNewProject, dispatch, loadAsUnsaved, needsVersionSyncRef, getJwt, setInternal, updateCloudMetadata],
  );

  const ops = useMemo(
    () => ({ saveToCloud, fork, deleteFromCloud, setVisibility, loadCloudProject }),
    [saveToCloud, fork, deleteFromCloud, setVisibility, loadCloudProject],
  );

  return { ...ops, loginRequired, pendingOpRef, dismissLogin };
}
