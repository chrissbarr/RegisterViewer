import { useState, useEffect, useCallback } from 'react';
import { Loader2, TriangleAlert } from 'lucide-react';
import { AppProvider } from '../context/app-context';
import { AppShell } from './layout/app-shell';
import { importFromJson, deserializeState, serializeState } from '../utils/storage';
import { createSeedRegisters } from '../utils/seed-data';
import { ADDRESS_UNIT_BITS_DEFAULT, type AppState } from '../types/register';
import { decompressSnapshot } from '../utils/snapshot-url';
import { isCloudEnabled } from '../utils/api-client';
import { friendlyErrorMessage } from '../utils/friendly-error';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { checkOwnership, getOwnerTokenForProject, hashOwnerToken } from '../utils/owner-token';
import { resolveInitialProject } from '../utils/project-resolution';
import {
  runMigrationIfNeeded,
  loadManifest,
  loadProject,
  createProject,
  getMostRecentProjectId,
} from '../utils/project-storage';

const ACTIVE_PROJECT_SESSION_KEY = 'register-viewer-active-project';

type LoaderState =
  | { phase: 'loading' }
  | { phase: 'ready'; initialState: AppState | undefined; cloudInit?: { projectId: string; isOwner: boolean }; localId?: string }
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

function createDefaultProject(): { state: AppState; localId: string } {
  const seedState = createSeedState();
  const localId = createProject(serializeState(seedState), 'Example Project');
  return { state: seedState, localId };
}

function parseSnapshotHash(hash: string): AppState | null {
  try {
    const encoded = hash.slice('#data='.length);
    const json = decompressSnapshot(encoded);
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
        const parsed = parseSnapshotHash(hash);
        if (parsed) {
          setState({ phase: 'ready', initialState: parsed });
        } else {
          setState({ phase: 'error', message: 'Failed to decode shared snapshot. The URL may be corrupted or invalid.' });
        }
        break;
      }

      case 'cloud': {
        // If the user owns this project, send auth so private projects don't 404
        const ownerToken = getOwnerTokenForProject(resolution.cloudId);
        const tokenHashPromise = ownerToken ? hashOwnerToken(ownerToken) : Promise.resolve(undefined);

        tokenHashPromise
          .then((tokenHash) => fetchAndParseCloudProject(resolution.cloudId, tokenHash))
          .then((importResult) => {
            const values: Record<string, bigint> = {};
            for (const reg of importResult.registers) {
              values[reg.id] = importResult.values[reg.id] ?? 0n;
            }

            const loadedState = buildAppState({
              registers: importResult.registers,
              values,
              project: importResult.project,
              addressUnitBits: importResult.addressUnitBits,
            });

            const isOwner = checkOwnership(resolution.cloudId);
            setState({
              phase: 'ready',
              initialState: loadedState,
              cloudInit: { projectId: resolution.cloudId, isOwner },
            });
          })
          .catch((err) => {
            setState({ phase: 'error', message: friendlyErrorMessage(err, 'Failed to load project.') });
          });
        break;
      }

      case 'local': {
        const project = loadProject(resolution.localId);
        if (project) {
          const appState = deserializeState(project.state);
          const cloudInit = project.cloudId
            ? { projectId: project.cloudId, isOwner: checkOwnership(project.cloudId) }
            : undefined;
          setState({ phase: 'ready', initialState: appState, localId: resolution.localId, cloudInit });
        } else {
          // Project record missing — fall back to creating default
          const { state: seedState, localId } = createDefaultProject();
          setState({ phase: 'ready', initialState: seedState, localId });
        }
        break;
      }

      case 'create-default': {
        const { state: seedState, localId } = createDefaultProject();
        setState({ phase: 'ready', initialState: seedState, localId });
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
        const appState = deserializeState(project.state);
        setState({ phase: 'ready', initialState: appState, localId: mostRecentId });
        return;
      }
    }
    const { state: seedState, localId } = createDefaultProject();
    setState({ phase: 'ready', initialState: seedState, localId });
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
    <AppProvider savedState={state.initialState} key={state.cloudInit?.projectId ?? state.localId ?? 'default'}>
      <AppShell cloudInit={state.cloudInit} initialLocalId={state.localId} />
    </AppProvider>
  );
}
