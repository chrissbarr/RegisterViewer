import { useState, useEffect, useCallback } from 'react';
import { AppProvider } from '../context/app-context';
import { AppShell } from './layout/app-shell';
import { loadFromLocalStorage, importFromJson } from '../utils/storage';
import { createSeedRegisters } from '../utils/seed-data';
import { SIDEBAR_WIDTH_DEFAULT, ADDRESS_UNIT_BITS_DEFAULT, type AppState } from '../types/register';
import { isSnapshotHash, isProjectHash, decompressSnapshot } from '../utils/snapshot-url';
import { isCloudEnabled } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { checkOwnership } from '../utils/owner-token';

type LoaderState =
  | { phase: 'loading' }
  | { phase: 'ready'; initialState: AppState | undefined; cloudInit?: { projectId: string; isOwner: boolean } }
  | { phase: 'error'; message: string };

function getDefaultState(): AppState | undefined {
  const saved = loadFromLocalStorage();
  if (saved) return saved;

  const seedRegisters = createSeedRegisters();
  const seedValues: Record<string, bigint> = {};
  for (const reg of seedRegisters) {
    seedValues[reg.id] = 0xDEADBEEFn;
  }
  return {
    registers: seedRegisters,
    activeRegisterId: seedRegisters[0]?.id ?? null,
    registerValues: seedValues,
    theme: 'dark',
    project: {
      title: 'Example Project',
      description: 'Demonstrates register field types. Open Project Settings from the menu to customize.',
    },
    sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
    sidebarCollapsed: false,
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
    addressUnitBits: ADDRESS_UNIT_BITS_DEFAULT,
  };
}

function parseSnapshotHash(hash: string): AppState | null {
  try {
    const encoded = hash.slice('#data='.length);
    const json = decompressSnapshot(encoded);
    const result = importFromJson(json);
    if (!result || result.registers.length === 0) return null;

    const defaultState = getDefaultState();
    const values: Record<string, bigint> = {};
    for (const reg of result.registers) {
      values[reg.id] = result.values[reg.id] ?? 0n;
    }
    return {
      registers: result.registers,
      activeRegisterId: result.registers[0]?.id ?? null,
      registerValues: values,
      theme: defaultState?.theme ?? 'dark',
      project: result.project,
      sidebarWidth: defaultState?.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT,
      sidebarCollapsed: defaultState?.sidebarCollapsed ?? false,
      mapTableWidth: defaultState?.mapTableWidth ?? 32,
      mapShowGaps: defaultState?.mapShowGaps ?? true,
      mapSortDescending: defaultState?.mapSortDescending ?? false,
      addressUnitBits: result.addressUnitBits ?? ADDRESS_UNIT_BITS_DEFAULT,
    };
  } catch {
    return null;
  }
}

function extractProjectId(hash: string): string | null {
  // #/p/{12-char-id}
  const match = hash.match(/^#\/p\/([A-Za-z0-9]{12})$/);
  return match ? match[1] : null;
}

export function AppLoader() {
  const [state, setState] = useState<LoaderState>({ phase: 'loading' });

  useEffect(() => {
    const hash = window.location.hash;

    // Snapshot URL: #data=...
    if (isSnapshotHash(hash)) {
      const parsed = parseSnapshotHash(hash);
      if (parsed) {
        setState({ phase: 'ready', initialState: parsed });
      } else {
        setState({ phase: 'error', message: 'Failed to decode shared snapshot. The URL may be corrupted or invalid.' });
      }
      return;
    }

    // Cloud project URL: #/p/{id}
    if (isProjectHash(hash) && isCloudEnabled()) {
      const projectId = extractProjectId(hash);
      if (!projectId) {
        setState({ phase: 'error', message: 'Invalid project URL.' });
        return;
      }

      fetchAndParseCloudProject(projectId)
        .then((importResult) => {
          const defaultState = getDefaultState();
          const values: Record<string, bigint> = {};
          for (const reg of importResult.registers) {
            values[reg.id] = importResult.values[reg.id] ?? 0n;
          }

          const loadedState: AppState = {
            registers: importResult.registers,
            activeRegisterId: importResult.registers[0]?.id ?? null,
            registerValues: values,
            theme: defaultState?.theme ?? 'dark',
            project: importResult.project,
            sidebarWidth: defaultState?.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT,
            sidebarCollapsed: defaultState?.sidebarCollapsed ?? false,
            mapTableWidth: defaultState?.mapTableWidth ?? 32,
            mapShowGaps: defaultState?.mapShowGaps ?? true,
            mapSortDescending: defaultState?.mapSortDescending ?? false,
            addressUnitBits: importResult.addressUnitBits ?? ADDRESS_UNIT_BITS_DEFAULT,
          };

          const isOwner = checkOwnership(projectId);
          setState({
            phase: 'ready',
            initialState: loadedState,
            cloudInit: { projectId, isOwner },
          });
        })
        .catch((err) => {
          const message = err instanceof Error ? err.message : 'Failed to load project.';
          setState({ phase: 'error', message });
        });
      return;
    }

    // Default: load from localStorage or seed data
    setState({ phase: 'ready', initialState: getDefaultState() });
  }, []);

  const handleContinue = useCallback(() => {
    // Clear the hash and load default state
    history.replaceState(null, '', window.location.pathname + window.location.search);
    setState({ phase: 'ready', initialState: getDefaultState() });
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
    <AppProvider savedState={state.initialState} key={state.cloudInit?.projectId ?? 'default'}>
      <AppShell cloudInit={state.cloudInit} />
    </AppProvider>
  );
}
