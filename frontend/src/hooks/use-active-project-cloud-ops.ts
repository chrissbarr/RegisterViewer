import { useCallback, useMemo, type Dispatch, type MutableRefObject } from 'react';
import { exportToObject, serializeState } from '../utils/storage';
import { isCloudEnabled, ApiError } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { buildProjectUrl } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock, requireJwt } from '../utils/cloud-url';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import { DEFAULT_PROJECT_NAME, type Visibility } from '../types/project';
import type { AppState } from '../types/register';
import { type CloudSyncCore, type CloudMetadataUpdate, initialInternalState } from '../types/cloud-sync';
import type { ImportStateAction } from '../context/app-context';

interface ActiveProjectCloudOpsDeps {
  core: CloudSyncCore;
  appStateRef: MutableRefObject<AppState>;
  dataVersionRef: MutableRefObject<number>;
  mutationLockRef: MutableRefObject<boolean>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  updateCloudMetadata: (localId: string, updates: CloudMetadataUpdate) => void;
  createNewProject: (name: string, state: ReturnType<typeof serializeState>) => string;
  getJwt: () => string | null;
  dispatch: Dispatch<ImportStateAction>;
}

interface ActiveProjectCloudOps {
  /** Returns false if the save was dropped because the mutation lock was held.
   *  When `stateOverride` is provided it is serialized instead of the live
   *  `appStateRef` — used by flush-before-evict to save the *previous*
   *  project's state after `appStateRef` already points to the new project. */
  saveToCloud: (stateOverride?: AppState) => Promise<boolean>;
  fork: () => Promise<void>;
  deleteFromCloud: () => Promise<void>;
  setVisibility: (v: Visibility) => Promise<void>;
  loadCloudProject: (cloudId: string) => Promise<void>;
}

/**
 * Cloud operations for the currently active project.
 *
 * Extracted from CloudSyncProvider to reduce its cognitive complexity.
 * All operations read latest state via refs (not direct state) to keep
 * callback references stable across renders.
 */
export function useActiveProjectCloudOps(deps: ActiveProjectCloudOpsDeps): ActiveProjectCloudOps {
  const {
    core: { internalRef, activeLocalIdRef, setInternal },
    appStateRef, dataVersionRef, mutationLockRef, needsVersionSyncRef,
    updateCloudMetadata, createNewProject, getJwt, dispatch,
  } = deps;

  const applyCreatedResult = useCallback((result: { cloudId: string; timestamp: string }) => {
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
    }));
  }, [updateCloudMetadata, createNewProject, dataVersionRef, activeLocalIdRef, appStateRef, setInternal]);

  /**
   * Flush-before-evict: save a departing project's state to the cloud before
   * its localStorage is evicted. Skips all post-save state updates and swallows
   * errors — the eviction handler keeps local data as a safety net.
   */
  const flushDepartingProject = useCallback(async (stateOverride: AppState) => {
    await withMutationLock(mutationLockRef, async () => {
      try {
        const { cloudId, isOwner } = internalRef.current;
        const existingCloudId = (cloudId && isOwner) ? cloudId : null;
        const jsonPayload = exportToObject(stateOverride);
        const jwt = requireJwt(getJwt);
        await saveProjectToCloudImpl(jsonPayload, existingCloudId, jwt);
      } catch {
        // Swallow — eviction handler keeps local data as safety net
      }
    });
  }, [mutationLockRef, getJwt, internalRef]);

  const saveToCloud = useCallback(async (stateOverride?: AppState): Promise<boolean> => {
    if (!isCloudEnabled()) return true;

    // When stateOverride is provided, this is a flush-before-evict save for
    // a departing project — delegate to the dedicated handler.
    if (stateOverride) {
      await flushDepartingProject(stateOverride);
      return true;
    }

    const lockResult = await withMutationLock(mutationLockRef, async () => {
      const capturedLocalId = activeLocalIdRef.current;
      try {
        const { cloudId, isOwner } = internalRef.current;
        const existingCloudId = (cloudId && isOwner) ? cloudId : null;

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const jsonPayload = exportToObject(appStateRef.current);
        const jwt = requireJwt(getJwt);
        const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, jwt);

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

        if (result.kind === 'created') {
          if (stillOnSameProject) {
            applyCreatedResult(result);
          }
        } else {
          if (capturedLocalId) {
            updateCloudMetadata(capturedLocalId, { cloudSavedAt: result.timestamp });
          }
          if (stillOnSameProject) {
            setInternal((prev) => ({
              ...prev,
              status: 'idle',
              lastCloudSavedAt: result.timestamp,
              lastSavedVersion: dataVersionRef.current,
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
  }, [flushDepartingProject, updateCloudMetadata, applyCreatedResult, mutationLockRef, dataVersionRef, getJwt, internalRef, appStateRef, activeLocalIdRef, setInternal]);

  const fork = useCallback(async () => {
    if (!isCloudEnabled()) return;
    await withMutationLock(mutationLockRef, async () => {
      setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
      try {
        const jsonPayload = exportToObject(appStateRef.current);
        const jwt = requireJwt(getJwt);
        const result = await saveProjectToCloudImpl(jsonPayload, null, jwt);
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
        setInternal({ ...initialInternalState });
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

  return useMemo(
    () => ({ saveToCloud, fork, deleteFromCloud, setVisibility, loadCloudProject }),
    [saveToCloud, fork, deleteFromCloud, setVisibility, loadCloudProject],
  );
}
