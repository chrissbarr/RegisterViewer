import { useState, useEffect, useCallback } from 'react';
import { AppProvider } from '../context/app-context';
import { AppShell } from './layout/app-shell';
import { importFromJson, deserializeState, serializeState } from '../utils/storage';
import { createSeedRegisters } from '../utils/seed-data';
import { ADDRESS_UNIT_BITS_DEFAULT, type AppState } from '../types/register';
import { decompressSnapshot } from '../utils/snapshot-url';
import { isCloudEnabled } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { checkOwnership, getOwnerTokenForProject, hashOwnerToken } from '../utils/owner-token';
import { resolveInitialProject } from '../utils/project-resolution';
import {
  runMigrationIfNeeded,
  loadManifest,
  loadProject,
  createProject,
} from '../utils/project-storage';

const ACTIVE_PROJECT_SESSION_KEY = 'register-viewer-active-project';

type LoaderState =
  | { phase: 'loading' }
  | { phase: 'ready'; initialState: AppState | undefined; cloudInit?: { projectId: string; isOwner: boolean }; localId?: string }
  | { phase: 'error'; message: string };

function createSeedState(): AppState {
  const seedRegisters = createSeedRegisters();
  const seedValues: Record<string, bigint> = {};
  for (const reg of seedRegisters) {
    seedValues[reg.id] = 0xDEADBEEFn;
  }
  return {
    registers: seedRegisters,
    activeRegisterId: seedRegisters[0]?.id ?? null,
    registerValues: seedValues,
    project: {
      title: 'Example Project',
      description: 'Demonstrates register field types. Open Project Settings from the menu to customize.',
    },
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
    addressUnitBits: ADDRESS_UNIT_BITS_DEFAULT,
  };
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
    return {
      registers: result.registers,
      activeRegisterId: result.registers[0]?.id ?? null,
      registerValues: values,
      project: result.project,
      mapTableWidth: 32,
      mapShowGaps: true,
      mapSortDescending: false,
      addressUnitBits: result.addressUnitBits ?? ADDRESS_UNIT_BITS_DEFAULT,
    };
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

            const loadedState: AppState = {
              registers: importResult.registers,
              activeRegisterId: importResult.registers[0]?.id ?? null,
              registerValues: values,
              project: importResult.project,
              mapTableWidth: 32,
              mapShowGaps: true,
              mapSortDescending: false,
              addressUnitBits: importResult.addressUnitBits ?? ADDRESS_UNIT_BITS_DEFAULT,
            };

            const isOwner = checkOwnership(resolution.cloudId);
            setState({
              phase: 'ready',
              initialState: loadedState,
              cloudInit: { projectId: resolution.cloudId, isOwner },
            });
          })
          .catch((err) => {
            const message = err instanceof Error ? err.message : 'Failed to load project.';
            setState({ phase: 'error', message });
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
    const manifest = loadManifest();
    if (manifest.projects.length > 0) {
      const sorted = [...manifest.projects].sort(
        (a, b) => new Date(b.localSavedAt).getTime() - new Date(a.localSavedAt).getTime(),
      );
      const project = loadProject(sorted[0].localId);
      if (project) {
        const appState = deserializeState(project.state);
        setState({ phase: 'ready', initialState: appState, localId: sorted[0].localId });
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
          <svg
            className="animate-spin h-8 w-8 text-blue-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
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
            <svg viewBox="0 0 16 16" width="24" height="24" fill="currentColor" className="text-red-400 shrink-0">
              <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575ZM8 5a.75.75 0 0 0-.75.75v2.5a.75.75 0 0 0 1.5 0v-2.5A.75.75 0 0 0 8 5Zm0 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
            </svg>
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
