import { useCallback, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import { exportToObject, serializeState } from '../utils/storage';
import { isCloudEnabled, ApiError } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { buildProjectUrl } from '../utils/project-storage';
import { setCloudUrl, clearCloudUrl, CLEARED_CLOUD_METADATA, withMutationLock, requireJwt } from '../utils/cloud-url';
import { saveProjectToCloudImpl, deleteProjectFromCloudImpl, patchVisibilityImpl } from '../utils/cloud-operations';
import { DEFAULT_PROJECT_NAME, type Visibility } from '../types/project';
import type { AppState, RegisterDef, ProjectMetadata, AddressUnitBits } from '../types/register';
import type { InternalCloudSyncState } from '../context/cloud-sync-context';

type ImportStateAction = {
  type: 'IMPORT_STATE';
  registers: RegisterDef[];
  values: Record<string, bigint>;
  project?: ProjectMetadata;
  addressUnitBits?: AddressUnitBits;
};

interface ActiveProjectCloudOpsDeps {
  internalRef: MutableRefObject<InternalCloudSyncState>;
  appStateRef: MutableRefObject<AppState>;
  activeLocalIdRef: MutableRefObject<string | null>;
  dataVersionRef: MutableRefObject<number>;
  mutationLockRef: MutableRefObject<boolean>;
  needsVersionSyncRef: MutableRefObject<boolean>;
  setInternal: Dispatch<SetStateAction<InternalCloudSyncState>>;
  updateCloudMetadata: (localId: string, updates: Partial<{
    cloudId: string | null;
    cloudSavedAt: string | null;
    visibility: Visibility;
  }>) => void;
  createNewProject: (name: string, state: ReturnType<typeof serializeState>) => string;
  getJwt: () => string | null;
  dispatch: Dispatch<ImportStateAction>;
  initialInternalState: InternalCloudSyncState;
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
    internalRef, appStateRef, activeLocalIdRef,
    dataVersionRef, mutationLockRef, needsVersionSyncRef,
    setInternal, updateCloudMetadata, createNewProject,
    getJwt, dispatch, initialInternalState,
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
    });

    const shareUrl = buildProjectUrl(result.cloudId);
    setCloudUrl(result.cloudId);

    setInternal((prev) => ({
      ...prev,
      cloudId: result.cloudId,
      isOwner: true,
      status: 'idle',
      shareUrl,
      lastCloudSavedAt: result.timestamp,
      lastSavedVersion: dataVersionRef.current,
    }));
  }, [updateCloudMetadata, createNewProject, dataVersionRef, activeLocalIdRef, appStateRef, setInternal]);

  const saveToCloud = useCallback(async (stateOverride?: AppState): Promise<boolean> => {
    if (!isCloudEnabled()) return true;
    const lockResult = await withMutationLock(mutationLockRef, async () => {
      // Capture localId before the await — during flush-before-evict,
      // activeLocalIdRef may already point to the new project by the
      // time the async save completes.
      const capturedLocalId = activeLocalIdRef.current;
      try {
        const { cloudId, isOwner } = internalRef.current;
        const existingCloudId = (cloudId && isOwner) ? cloudId : null;

        setInternal((prev) => ({ ...prev, status: 'saving', error: null }));
        const jsonPayload = exportToObject(stateOverride ?? appStateRef.current);
        const jwt = requireJwt(getJwt);
        const result = await saveProjectToCloudImpl(jsonPayload, existingCloudId, jwt);

        // Guard: only update internal cloud state if still on the same
        // saved project. When capturedLocalId is null (unsaved project),
        // skip all internal state updates to prevent flush-before-evict
        // results/errors from bleeding into the unsaved project's state.
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
          // Only update internal state if we're still on the same project.
          // During flush-before-evict, internal state already belongs to
          // the new project — updating it would set the wrong timestamp
          // and lastSavedVersion.
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
        // Only surface the error if we're still on the same saved project
        if (capturedLocalId !== null && activeLocalIdRef.current === capturedLocalId) {
          const next = { ...internalRef.current, status: 'idle' as const, error: friendlyErrorMessage(err, 'Failed to save project.') };
          internalRef.current = next;
          setInternal(next);
        }
      }
    });
    return lockResult.executed;
  }, [updateCloudMetadata, applyCreatedResult, mutationLockRef, dataVersionRef, getJwt, internalRef, appStateRef, activeLocalIdRef, setInternal]);

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
  }, [updateCloudMetadata, mutationLockRef, getJwt, internalRef, activeLocalIdRef, setInternal, initialInternalState]);

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
