import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { AppProvider } from '../context/app-context';
import { AppShell } from './layout/app-shell';
import { importFromJson, deserializeState, serializeState, serializeImportResult } from '../utils/storage';
import { createSeedRegisters } from '../utils/seed-data';
import { ADDRESS_UNIT_BITS_DEFAULT, type AppState } from '../types/register';
import { decompressSnapshot } from '../utils/snapshot-url';
import { isCloudEnabled } from '../utils/api-client';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { JWT_STORAGE_KEY } from '../context/auth-context';
import { resolveInitialProject } from '../utils/project-resolution';
import { DEFAULT_PROJECT_NAME, type ProjectManifest, type ProjectManifestEntry, type StoredLocalProject, type UnsavedProjectSource } from '../types/project';
import {
  runMigrationIfNeeded,
  loadManifest,
  loadProject,
  saveProject,
  createProject,
  getMostRecentProjectId,
  ACTIVE_PROJECT_SESSION_KEY,
  UNSAVED_SESSION_SENTINEL,
  loadUnsavedProject,
  saveUnsavedProjectState,
} from '../utils/project-storage';
import type { CloudInit } from '../types/cloud-sync';

type CloudProjectLoadResult = Awaited<ReturnType<typeof fetchAndParseCloudProject>>;

type LoaderState =
  | { phase: 'loading' }
  | {
      phase: 'ready';
      initialState: AppState | undefined;
      cloudInit?: CloudInit;
      localId: string;
      unsaved?: undefined;
    }
  | {
      phase: 'ready';
      initialState: AppState | undefined;
      cloudInit?: CloudInit;
      localId?: undefined;
      unsaved: { name: string; source: UnsavedProjectSource };
    }
  | { phase: 'error'; message: string };

/** Build an AppState from import-style data, filling in map/sort defaults. */
function buildAppState(data: {
  registers: AppState['registers'];
  values: Record<string, bigint>;
  project?: AppState['project'];
  addressUnitBits?: AppState['addressUnitBits'];
}): AppState {
  return {
    registers: data.registers,
    activeRegisterId: data.registers[0]?.id ?? null,
    registerValues: data.values,
    project: data.project,
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
    addressUnitBits: data.addressUnitBits ?? ADDRESS_UNIT_BITS_DEFAULT,
  };
}

function createSeedState(): AppState {
  const seedRegisters = createSeedRegisters();
  const seedValues: Record<string, bigint> = {};
  for (const reg of seedRegisters) {
    seedValues[reg.id] = 0xDEADBEEFn;
  }
  return buildAppState({
    registers: seedRegisters,
    values: seedValues,
    project: {
      title: 'Example Project',
      description: 'Demonstrates register field types. Open Project Settings from the menu to customize.',
    },
  });
}

function createDefaultUnsavedProject(): { state: AppState; unsaved: { name: string; source: UnsavedProjectSource } } {
  const seedState = createSeedState();
  persistUnsavedProjectState('Example Project', seedState, 'seed');
  return { state: seedState, unsaved: { name: 'Example Project', source: 'seed' } };
}

function getStateDisplayName(state: AppState): string {
  return state.project?.title?.trim() || DEFAULT_PROJECT_NAME;
}

function getImportDisplayName(importResult: Pick<CloudProjectLoadResult, 'project'>): string {
  return importResult.project?.title?.trim() || DEFAULT_PROJECT_NAME;
}

function persistUnsavedProjectState(
  name: string,
  state: AppState,
  source: UnsavedProjectSource,
): { name: string; source: UnsavedProjectSource } {
  const result = saveUnsavedProjectState(name, serializeState(state), source);
  if (!result.ok) throw new Error(`Failed to persist unsaved project: ${result.status}`);
  try {
    sessionStorage.setItem(ACTIVE_PROJECT_SESSION_KEY, UNSAVED_SESSION_SENTINEL);
  } catch { /* sessionStorage unavailable */ }
  return { name, source };
}

function clearHashAfterSuccessfulLoad(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

async function parseSnapshotHash(hash: string): Promise<AppState | null> {
  try {
    const encoded = hash.slice('#data='.length);
    const json = await decompressSnapshot(encoded);
    const result = importFromJson(json);
    if (!result || result.registers.length === 0) return null;

    const values: Record<string, bigint> = {};
    for (const reg of result.registers) {
      values[reg.id] = result.values[reg.id] ?? 0n;
    }
    return buildAppState({
      registers: result.registers,
      values,
      project: result.project,
      addressUnitBits: result.addressUnitBits,
    });
  } catch {
    return null;
  }
}

function buildCloudAppState(importResult: Pick<CloudProjectLoadResult, 'registers' | 'values' | 'project' | 'addressUnitBits'>): AppState {
  const values: Record<string, bigint> = {};
  for (const reg of importResult.registers) {
    values[reg.id] = importResult.values[reg.id] ?? 0n;
  }

  return buildAppState({
    registers: importResult.registers,
    values,
    project: importResult.project,
    addressUnitBits: importResult.addressUnitBits,
  });
}

function persistDownloadedCloudProject(
  localId: string,
  entry: ProjectManifestEntry & { cloudId: string },
  importResult: CloudProjectLoadResult,
  storage: 'local' | 'cloud' = entry.storage === 'cloud' && importResult.isOwner ? 'cloud' : 'local',
): 'local' | 'cloud' {
  const result = saveProject({
    localId,
    cloudId: entry.cloudId,
    name: entry.name,
    visibility: importResult.visibility,
    createdAt: entry.createdAt,
    localSavedAt: new Date().toISOString(),
    cloudSavedAt: importResult.updatedAt,
    serverVersion: importResult.version,
    cloudConflictVersion: null,
    hasUnsyncedChanges: false,
    storage,
    state: serializeImportResult(importResult),
  }, { protectedLocalIds: [localId] });
  if (!result.ok) throw new Error(`Failed to persist downloaded project: ${result.status}`);
  return storage;
}

function isCloudCacheDirtyOrConflicted(entry: ProjectManifestEntry, project: StoredLocalProject | null): boolean {
  return !!entry.cloudConflictVersion
    || !!project?.cloudConflictVersion
    || entry.hasUnsyncedChanges === true
    || project?.hasUnsyncedChanges === true;
}

function findReusableOwnedCloudEntry(manifest: ProjectManifest, cloudId: string): ProjectManifestEntry | null {
  return manifest.projects.find(p => p.cloudId === cloudId) ?? null;
}

function cloudInitFromStoredProject(project: StoredLocalProject): CloudInit | undefined {
  if (!project.cloudId) return undefined;
  return {
    projectId: project.cloudId,
    isOwner: project.storage === 'cloud',
    storage: project.storage,
    serverVersion: project.serverVersion ?? null,
    cloudSavedAt: project.cloudSavedAt ?? null,
    visibility: project.visibility,
    cloudConflictVersion: project.cloudConflictVersion ?? null,
    hasUnsyncedChanges: project.hasUnsyncedChanges,
  };
}

function readyFromStoredProject(localId: string, project: StoredLocalProject): Extract<LoaderState, { phase: 'ready'; localId: string }> {
  return {
    phase: 'ready',
    initialState: deserializeState(project.state),
    localId,
    cloudInit: cloudInitFromStoredProject(project),
  };
}

function findCachedCloudProject(manifest: ProjectManifest, cloudId: string): { entry: ProjectManifestEntry; project: StoredLocalProject } | null {
  for (const entry of manifest.projects) {
    if (entry.cloudId !== cloudId) continue;
    const project = loadProject(entry.localId);
    if (project) return { entry, project };
  }
  return null;
}

function createOwnedCloudProject(importResult: CloudProjectLoadResult, cloudId: string): string {
  return createProject(
    serializeImportResult(importResult),
    getImportDisplayName(importResult),
    {
      cloudId,
      visibility: importResult.visibility,
      cloudSavedAt: importResult.updatedAt,
      serverVersion: importResult.version,
      hasUnsyncedChanges: false,
      storage: 'cloud',
    },
    { protectedLocalIds: [getSessionActiveId()] },
  );
}

function hydrateOrLoadOwnedCloudProject(
  manifest: ProjectManifest,
  cloudId: string,
  importResult: CloudProjectLoadResult,
): { state: AppState; localId: string; cloudInit: CloudInit } {
  const reusableEntry = findReusableOwnedCloudEntry(manifest, cloudId);

  if (reusableEntry) {
    const cachedProject = loadProject(reusableEntry.localId);
    if (cachedProject && isCloudCacheDirtyOrConflicted(reusableEntry, cachedProject)) {
      const cachedState = cachedProject ? deserializeState(cachedProject.state) : buildCloudAppState(importResult);
      return {
        state: cachedState,
        localId: reusableEntry.localId,
        cloudInit: {
          projectId: cloudId,
          isOwner: true,
          storage: 'cloud',
          serverVersion: cachedProject?.serverVersion ?? reusableEntry.serverVersion ?? importResult.version,
          cloudSavedAt: cachedProject?.cloudSavedAt ?? reusableEntry.cloudSavedAt ?? importResult.updatedAt,
          visibility: cachedProject?.visibility ?? reusableEntry.visibility,
          cloudConflictVersion: cachedProject?.cloudConflictVersion ?? reusableEntry.cloudConflictVersion ?? null,
          hasUnsyncedChanges: cachedProject?.hasUnsyncedChanges ?? reusableEntry.hasUnsyncedChanges,
        },
      };
    }

    const storage = persistDownloadedCloudProject(reusableEntry.localId, { ...reusableEntry, cloudId }, importResult, 'cloud');
    return {
      state: buildCloudAppState(importResult),
      localId: reusableEntry.localId,
      cloudInit: {
        projectId: cloudId,
        isOwner: storage === 'cloud',
        storage,
        serverVersion: importResult.version,
        cloudSavedAt: importResult.updatedAt,
        visibility: importResult.visibility,
      },
    };
  }

  const localId = createOwnedCloudProject(importResult, cloudId);
  return {
    state: buildCloudAppState(importResult),
    localId,
    cloudInit: {
      projectId: cloudId,
      isOwner: true,
      storage: 'cloud',
      serverVersion: importResult.version,
      cloudSavedAt: importResult.updatedAt,
      visibility: importResult.visibility,
    },
  };
}

/** Read JWT from localStorage before auth context is available. */
function readStartupJwt(): string | null {
  try {
    return localStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function getSessionActiveId(): string | null {
  try {
    return sessionStorage.getItem(ACTIVE_PROJECT_SESSION_KEY);
  } catch {
    return null;
  }
}

export function AppLoader() {
  const [state, setState] = useState<LoaderState>({ phase: 'loading' });

  useEffect(() => {
    // Step 1: Run migration from legacy storage
    runMigrationIfNeeded();

    // Step 2: Load manifest and resolve initial project
    const manifest = loadManifest();
    const hash = window.location.hash;
    const sessionActiveId = getSessionActiveId();
    const cloudEnabled = isCloudEnabled();

    const resolution = resolveInitialProject(hash, manifest, sessionActiveId, cloudEnabled);

    switch (resolution.type) {
      case 'snapshot': {
        parseSnapshotHash(hash)
          .then((parsed) => {
            if (parsed) {
              const unsaved = persistUnsavedProjectState(getStateDisplayName(parsed), parsed, 'import');
              clearHashAfterSuccessfulLoad();
              setState({ phase: 'ready', initialState: parsed, unsaved });
            } else {
              setState({ phase: 'error', message: 'Failed to decode shared snapshot. The URL may be corrupted or invalid.' });
            }
          })
          .catch(() => {
            setState({ phase: 'error', message: 'Failed to decode shared snapshot. The URL may be corrupted or invalid.' });
          });
        break;
      }

      case 'cloud': {
        const jwt = readStartupJwt();

        fetchAndParseCloudProject(resolution.cloudId, jwt ?? undefined)
          .then((importResult) => {
            const loadedState = buildCloudAppState(importResult);

            if (!importResult.isOwner) {
              const unsaved = persistUnsavedProjectState(getImportDisplayName(importResult), loadedState, 'cloud');
              clearHashAfterSuccessfulLoad();
              setState({
                phase: 'ready',
                initialState: loadedState,
                unsaved,
                cloudInit: {
                  projectId: resolution.cloudId,
                  isOwner: false,
                  storage: 'local',
                  serverVersion: importResult.version,
                  cloudSavedAt: importResult.updatedAt,
                  visibility: importResult.visibility,
                },
              });
              return;
            }

            const owned = hydrateOrLoadOwnedCloudProject(manifest, resolution.cloudId, importResult);

            setState({
              phase: 'ready',
              initialState: owned.state,
              localId: owned.localId,
              cloudInit: owned.cloudInit,
            });
          })
          .catch((err) => {
            const cached = findCachedCloudProject(manifest, resolution.cloudId);
            if (cached) {
              setState(readyFromStoredProject(cached.entry.localId, cached.project));
              return;
            }
            setState({ phase: 'error', message: friendlyErrorMessage(err, 'Failed to load project.') });
          });
        break;
      }

      case 'local': {
        const project = loadProject(resolution.localId);
        if (project) {
          void Promise.resolve().then(() => {
            setState(readyFromStoredProject(resolution.localId, project));
          });
        } else {
          const entry = manifest.projects.find(p => p.localId === resolution.localId);
          if (entry?.cloudId) {
            const cloudId = entry.cloudId;
            const jwt = readStartupJwt();
            fetchAndParseCloudProject(cloudId, jwt ?? undefined)
              .then((importResult) => {
                const storage = persistDownloadedCloudProject(resolution.localId, { ...entry, cloudId }, importResult);
                const appState = buildCloudAppState(importResult);
                setState({
                  phase: 'ready',
                  initialState: appState,
                  localId: resolution.localId,
                  cloudInit: {
                    projectId: cloudId,
                    isOwner: storage === 'cloud',
                    storage,
                    serverVersion: importResult.version,
                    cloudSavedAt: importResult.updatedAt,
                    visibility: importResult.visibility,
                  },
                });
              })
              .catch((err) => {
                setState({ phase: 'error', message: friendlyErrorMessage(err, 'Failed to load project.') });
              });
          } else {
            // Project record missing — fall back to creating default (unsaved)
            const { state: seedState, unsaved } = createDefaultUnsavedProject();
            void Promise.resolve().then(() => {
              setState({ phase: 'ready', initialState: seedState, unsaved });
            });
          }
        }
        break;
      }

      case 'unsaved': {
        const unsavedData = loadUnsavedProject();
        if (unsavedData) {
          const appState = deserializeState(unsavedData.state);
          void Promise.resolve().then(() => {
            setState({
              phase: 'ready',
              initialState: appState,
              unsaved: { name: unsavedData.name, source: unsavedData.source ?? 'new' },
            });
          });
        } else {
          // Unsaved data was cleared externally — fall through to most recent or seed
          const mostRecentId = getMostRecentProjectId();
          if (mostRecentId) {
            const project = loadProject(mostRecentId);
            if (project) {
              void Promise.resolve().then(() => {
                setState(readyFromStoredProject(mostRecentId, project));
              });
              break;
            }
          }
          const { state: seedState, unsaved } = createDefaultUnsavedProject();
          void Promise.resolve().then(() => {
            setState({ phase: 'ready', initialState: seedState, unsaved });
          });
        }
        break;
      }

      case 'create-default': {
        const { state: seedState, unsaved } = createDefaultUnsavedProject();
        void Promise.resolve().then(() => {
          setState({ phase: 'ready', initialState: seedState, unsaved });
        });
        break;
      }
    }
  }, []);

  const handleContinue = useCallback(() => {
    // Clear the hash and load default state
    history.replaceState(null, '', window.location.pathname + window.location.search);
    runMigrationIfNeeded();
    const mostRecentId = getMostRecentProjectId();
    if (mostRecentId) {
      const project = loadProject(mostRecentId);
      if (project) {
        setState(readyFromStoredProject(mostRecentId, project));
        return;
      }
    }
    const { state: seedState, unsaved } = createDefaultUnsavedProject();
    setState({ phase: 'ready', initialState: seedState, unsaved });
  }, []);

  if (state.phase === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-100">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin h-8 w-8 text-blue-500" />
          <p className="text-sm text-gray-400">Loading project...</p>
        </div>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-950 text-gray-100">
        <div className="max-w-md w-full mx-4 rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-xl">
          <div className="flex items-center gap-3 mb-4">
            <TriangleAlert size={24} className="text-red-400 shrink-0" />
            <h2 className="text-lg font-bold">Unable to load project</h2>
          </div>
          <p className="text-sm text-gray-300 mb-6">{state.message}</p>
          <button
            onClick={handleContinue}
            className="w-full px-4 py-2 rounded-lg text-sm font-medium
              bg-blue-600 hover:bg-blue-500 text-white
              transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            Continue to Register Viewer
          </button>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="h-full"
    >
      <AppProvider savedState={state.initialState} key={state.cloudInit?.projectId ?? state.localId ?? 'default'}>
        <AppShell cloudInit={state.cloudInit} initialLocalId={state.localId} initialUnsaved={state.unsaved} />
      </AppProvider>
    </motion.div>
  );
}
