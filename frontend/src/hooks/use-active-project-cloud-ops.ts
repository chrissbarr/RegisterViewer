import { useCallback, useMemo, useRef, useState, type Dispatch, type MutableRefObject } from 'react';
import { exportToObject, serializeState } from '../utils/storage';
import { isCloudEnabled, ApiError } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { checkAndPullFreshVersion, type FreshnessCheckContext } from '../utils/cloud-freshness';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { buildProjectUrl } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock, requireJwt } from '../utils/cloud-utils';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl, type SaveConflictResult } from '../utils/cloud-operations';
import { DEFAULT_PROJECT_NAME, type Visibility } from '../types/project';
import type { AppState } from '../types/register';
import { type CloudSyncCore, type CloudMetadataUpdate, type InternalCloudSyncState, initialInternalState } from '../types/cloud-sync';
import type { ImportStateAction } from '../context/app-context';

interface ConflictHandlerParams {
  result: SaveConflictResult;
  preDataVersion: number;
  dataVersionRef: MutableRefObject<number>;
  capturedLocalId: string | null;
  existingCloudId: string | null;
  activeLocalIdRef: MutableRefObject<string | null>;
  internalRef: MutableRefObject<InternalCloudSyncState>;
  lastFreshnessCheckRef: MutableRefObject<number>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => void;
  setInternal: (updater: (prev: InternalCloudSyncState) => InternalCloudSyncState) => void;
  dispatch: (action: ImportStateAction) => void;
  getJwt: () => string | null;
}

async function handleConflictResult(params: ConflictHandlerParams): Promise<void> {
  const {
    result, preDataVersion, dataVersionRef, capturedLocalId, existingCloudId,
    activeLocalIdRef, internalRef, lastFreshnessCheckRef, needsVersionSyncRef,
    updateCloudMetadata, setInternal, dispatch, getJwt,
  } = params;

  const stillDirty = dataVersionRef.current !== preDataVersion;

  if (stillDirty) {
    // Dirty 409: user edited during save — update version + show conflict UX in one call
    setInternal((prev) => ({
      ...prev,
      status: 'idle',
      serverVersion: result.serverVersion,
      conflict: { serverVersion: result.serverVersion },
    }));
    return;
  }

  // Clean 409: no local edits — update version and pull server version silently
  setInternal((prev) => ({
    ...prev,
    status: 'idle',
    serverVersion: result.serverVersion,
  }));

  try {
    const freshJwt = getJwt();
    if (freshJwt && capturedLocalId && existingCloudId) {
      const freshnessCtx: FreshnessCheckContext = {
        internalRef, dataVersionRef, dispatch, needsVersionSyncRef,
        lastFreshnessCheckRef, updateCloudMetadata, setInternal,
      };
      await checkAndPullFreshVersion(freshnessCtx, {
        cloudId: existingCloudId,
        knownVersion: 0,
        localId: capturedLocalId,
        jwt: freshJwt,
        force: true,
      });
    }
  } catch {
    // Pull failed — show conflict UX as fallback
    if (capturedLocalId !== null && activeLocalIdRef.current === capturedLocalId) {
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
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => void;
  createNewProject: (name: string, state: ReturnType<typeof serializeState>) => string;
  getJwt: () => string | null;
  dispatch: Dispatch<ImportStateAction>;
}

interface ActiveProjectCloudOps {
  saveToCloud: () => Promise<boolean>;
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
    updateCloudMetadata, createNewProject, getJwt, dispatch,
  } = deps;

  // Login guard state (absorbed from useLoginGuard)
  const [loginRequired, setLoginRequired] = useState(false);
  const pendingOpRef = useRef<'save' | 'fork' | null>(null);

  const dismissLogin = useCallback(() => {
    setLoginRequired(false);
    pendingOpRef.current = null;
  }, []);

  const applyCreatedResult = useCallback((result: { cloudId: string; timestamp: string; version: number }) => {
    let currentLocalId = activeLocalIdRef.current;

    // When forking a shared project, no local project exists yet — create one
    if (!currentLocalId) {
      const serialized = serializeState(appStateRef.current);
      const name = appStateRef.current.project?.title ?? DEFAULT_PROJECT_NAME;
      currentLocalId = createNewProject(name, serialized);
    }

    updateCloudMetadata(currentLocalId, {
      cloudId: result.cloudId,
      cloudSavedAt: result.timestamp,
      storage: 'cloud',
      serverVersion: result.version,
    });

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
      lastSavedVersion: dataVersionRef.current,
      serverVersion: result.version,
      conflict: null,
    }));
  }, [updateCloudMetadata, createNewProject, dataVersionRef, activeLocalIdRef, appStateRef, setInternal]);

  const saveToCloud = useCallback(async (): Promise<boolean> => {
    if (!isCloudEnabled()) return true;

    // JWT guard: defer to login dialog if not authenticated
    const jwt = getJwt();
    if (!jwt) {
      setLoginRequired(true);
      pendingOpRef.current = 'save';
      return false;
    }

    const lockResult = await withMutationLock(mutationLockRef, async () => {
      const capturedLocalId = activeLocalIdRef.current;
      try {
        const { cloudId, isOwner, serverVersion } = internalRef.current;
        const existingCloudId = (cloudId && isOwner) ? cloudId : null;

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const jsonPayload = exportToObject(appStateRef.current);
        const freshJwt = requireJwt(getJwt);
        const preDataVersion = dataVersionRef.current;
        const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, freshJwt, serverVersion > 0 ? serverVersion : undefined);

        // Guard: only update internal cloud state if still on the same
        // saved project. When capturedLocalId is null (unsaved project),
        // skip all internal state updates.
        const stillOnSameProject = capturedLocalId !== null
          && activeLocalIdRef.current === capturedLocalId;

        if (result.kind === 'not-found') {
          if (capturedLocalId) {
            updateCloudMetadata(capturedLocalId, CLEARED_CLOUD_METADATA);
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
          return;
        }

        if (result.kind === 'conflict') {
          await handleConflictResult({
            result, preDataVersion, dataVersionRef, capturedLocalId, existingCloudId,
            activeLocalIdRef, internalRef, lastFreshnessCheckRef, needsVersionSyncRef,
            updateCloudMetadata, setInternal, dispatch, getJwt,
          });
          return;
        }

        if (result.kind === 'created') {
          if (stillOnSameProject) {
            applyCreatedResult(result);
          }
        } else {
          if (capturedLocalId) {
            updateCloudMetadata(capturedLocalId, { cloudSavedAt: result.timestamp, serverVersion: result.version });
          }
          if (stillOnSameProject) {
            setInternal((prev) => ({
              ...prev,
              status: 'idle',
              lastCloudSavedAt: result.timestamp,
              lastSavedVersion: dataVersionRef.current,
              serverVersion: result.version,
              conflict: null,
            }));
          }
        }
      } catch (err) {
        if (capturedLocalId !== null && activeLocalIdRef.current === capturedLocalId) {
          const next = { ...internalRef.current, status: 'idle' as const, error: friendlyErrorMessage(err, 'Failed to save project.') };
          internalRef.current = next;
          setInternal(next);
        }
        throw err;
      }
    });
    return lockResult.executed;
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
        const jsonPayload = exportToObject(appStateRef.current);
        const freshJwt = requireJwt(getJwt);
        const result = await saveProjectToCloudImpl(jsonPayload, null, freshJwt);
        if (result.kind !== 'created') throw new Error('Failed to save copy.');
        applyCreatedResult(result);
      } catch (err) {
        setInternal((prev) => ({ ...prev, status: 'idle', error: friendlyErrorMessage(err, 'Failed to save copy.') }));
      }
    });
  }, [applyCreatedResult, mutationLockRef, getJwt, appStateRef, setInternal]);

  const deleteFromCloud = useCallback(async () => {
    const { cloudId } = internalRef.current;
    if (!cloudId) return;
    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'deleting', error: null }));
      try {
        const jwt = requireJwt(getJwt);
        await deleteProjectFromCloudImpl(cloudId, jwt);

        const currentLocalId = activeLocalIdRef.current;
        if (currentLocalId) {
          updateCloudMetadata(currentLocalId, CLEARED_CLOUD_METADATA);
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
        await patchVisibilityImpl(cloudId, v, jwt);

        const currentLocalId = activeLocalIdRef.current;
        if (currentLocalId) {
          updateCloudMetadata(currentLocalId, { visibility: v });
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

        dispatch({
          type: 'IMPORT_STATE',
          registers: importResult.registers,
          values: importResult.values,
          project: importResult.project,
          addressUnitBits: importResult.addressUnitBits,
        });

        const isOwner = importResult.isOwner;
        const shareUrl = buildProjectUrl(cloudId);

        // Signal the version-tracking useEffect to capture lastSavedVersion
        needsVersionSyncRef.current = true;

        setInternal((prev) => ({
          ...prev,
          cloudId,
          isOwner,
          status: 'idle',
          shareUrl,
          lastCloudSavedAt: importResult.updatedAt,
          serverVersion: importResult.version,
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
    [dispatch, needsVersionSyncRef, getJwt, setInternal],
  );

  const ops = useMemo(
    () => ({ saveToCloud, fork, deleteFromCloud, setVisibility, loadCloudProject }),
    [saveToCloud, fork, deleteFromCloud, setVisibility, loadCloudProject],
  );

  return { ...ops, loginRequired, pendingOpRef, dismissLogin };
}
