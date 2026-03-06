import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { ReactNode } from 'react';
import { AppLoader } from './app-loader';
import { makeRegister, makeState } from '../test/helpers';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/storage', () => ({
  importFromJson: vi.fn(() => null),
  deserializeState: vi.fn((data: unknown) => data),
  serializeState: vi.fn((state: unknown) => state),
}));

vi.mock('../utils/seed-data', () => ({
  createSeedRegisters: vi.fn(() => []),
}));

vi.mock('../utils/snapshot-url', () => ({
  decompressSnapshot: vi.fn(() => '{}'),
}));

vi.mock('../utils/api-client', () => ({
  isCloudEnabled: vi.fn(() => false),
}));

vi.mock('../utils/cloud-project-loader', () => ({
  fetchAndParseCloudProject: vi.fn(),
}));

vi.mock('../utils/project-resolution', () => ({
  resolveInitialProject: vi.fn(() => ({ type: 'create-default' })),
}));

vi.mock('../utils/project-storage', () => ({
  runMigrationIfNeeded: vi.fn(),
  loadManifest: vi.fn(() => ({ version: 1, projects: [] })),
  loadProject: vi.fn(() => null),
  createProject: vi.fn(() => 'new-local-id'),
  getMostRecentProjectId: vi.fn(() => null),
  ACTIVE_PROJECT_SESSION_KEY: 'register-viewer-active-project',
  UNSAVED_SESSION_SENTINEL: '__unsaved__',
  saveUnsavedProjectState: vi.fn(),
  loadUnsavedProject: vi.fn(() => null),
  clearUnsavedProject: vi.fn(),
}));

vi.mock('../context/app-context', () => ({
  AppProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./layout/app-shell', () => ({
  AppShell: ({ cloudInit, initialLocalId, initialUnsaved }: { cloudInit?: { projectId: string; isOwner: boolean }; initialLocalId?: string | null; initialUnsaved?: { name: string; source: string } | null }) => (
    <div
      data-testid="app-shell"
      data-cloud-id={cloudInit?.projectId ?? ''}
      data-is-owner={String(cloudInit?.isOwner ?? false)}
      data-local-id={initialLocalId ?? ''}
      data-unsaved-name={initialUnsaved?.name ?? ''}
      data-unsaved-source={initialUnsaved?.source ?? ''}
    />
  ),
}));

// Stub history.replaceState so it doesn't error in jsdom
vi.spyOn(history, 'replaceState').mockImplementation(() => {});

// ── Imports for mocked modules ───────────────────────────────────────

import { importFromJson, deserializeState, serializeState } from '../utils/storage';
import { createSeedRegisters } from '../utils/seed-data';
import { decompressSnapshot } from '../utils/snapshot-url';
import { isCloudEnabled } from '../utils/api-client';
import { fetchAndParseCloudProject } from '../utils/cloud-project-loader';
import { resolveInitialProject } from '../utils/project-resolution';
import {
  runMigrationIfNeeded,
  loadManifest,
  loadProject,
  createProject,
  getMostRecentProjectId,
  saveUnsavedProjectState,
} from '../utils/project-storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_REGISTER = makeRegister({ id: 'reg-1', name: 'REG_A' });
const TEST_APP_STATE = makeState({
  registers: [TEST_REGISTER],
  activeRegisterId: 'reg-1',
  registerValues: { 'reg-1': 0xFFn },
});

function makeImportResult(overrides: Record<string, unknown> = {}) {
  return {
    registers: [TEST_REGISTER],
    values: { 'reg-1': 0xFFn },
    project: { title: 'Test Project' },
    addressUnitBits: 8,
    ...overrides,
  };
}

function makeStoredProject(overrides: Record<string, unknown> = {}) {
  return {
    localId: 'local-abc',
    cloudId: null as string | null,
    name: 'Stored Project',
    state: TEST_APP_STATE,
    ...overrides,
  };
}

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();

  // Reset window.location.hash
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hash: '', pathname: '/', search: '' },
    writable: true,
    configurable: true,
  });

  // Default: no-op mocks
  (runMigrationIfNeeded as Mock).mockReturnValue(undefined);
  (loadManifest as Mock).mockReturnValue({ version: 1, projects: [] });
  (isCloudEnabled as Mock).mockReturnValue(false);
  (resolveInitialProject as Mock).mockReturnValue({ type: 'create-default' });
  (createProject as Mock).mockReturnValue('new-local-id');
  (createSeedRegisters as Mock).mockReturnValue([]);
  (serializeState as Mock).mockReturnValue({});
  (deserializeState as Mock).mockReturnValue(TEST_APP_STATE);
  (loadProject as Mock).mockReturnValue(null);
  (getMostRecentProjectId as Mock).mockReturnValue(null);
  (decompressSnapshot as Mock).mockReturnValue('{}');
  (importFromJson as Mock).mockReturnValue(null);
  (fetchAndParseCloudProject as Mock).mockRejectedValue(new Error('Not called'));
});

// ── Tests ────────────────────────────────────────────────────────────

describe('AppLoader', () => {
  describe('loading state', () => {
    it('renders spinner initially', () => {
      // Never resolves — keep in loading state
      (resolveInitialProject as Mock).mockImplementation(() => {
        // Return a value that causes a cloud async path so it stays loading
        return { type: 'cloud', cloudId: 'cloud-abc' };
      });
      (fetchAndParseCloudProject as Mock).mockImplementation(
        () => new Promise(() => {}), // never resolves
      );

      render(<AppLoader />);

      expect(screen.getByText('Loading project...')).toBeInTheDocument();
    });

    it('shows a spinner SVG during loading', () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc' });
      (fetchAndParseCloudProject as Mock).mockImplementation(() => new Promise(() => {}));

      const { container } = render(<AppLoader />);
      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  describe('create-default branch', () => {
    it('creates unsaved seed project and renders AppShell', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'create-default' });
      (createSeedRegisters as Mock).mockReturnValue([TEST_REGISTER]);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(saveUnsavedProjectState).toHaveBeenCalled();
      // Should NOT create a saved project
      expect(createProject).not.toHaveBeenCalled();
    });

    it('passes unsaved data to AppShell instead of localId', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'create-default' });
      (createSeedRegisters as Mock).mockReturnValue([TEST_REGISTER]);

      render(<AppLoader />);

      await waitFor(() => {
        const shell = screen.getByTestId('app-shell');
        expect(shell.dataset.localId).toBe('');
        expect(shell.dataset.unsavedName).toBe('Example Project');
        expect(shell.dataset.unsavedSource).toBe('seed');
      });
    });

    it('calls runMigrationIfNeeded on mount', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'create-default' });

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(runMigrationIfNeeded).toHaveBeenCalled();
    });
  });

  describe('snapshot URL branch', () => {
    it('parses valid snapshot hash and renders AppShell', async () => {
      const importResult = makeImportResult();
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'compressed-data' });
      (decompressSnapshot as Mock).mockReturnValue('{"registers":[]}');
      (importFromJson as Mock).mockReturnValue(importResult);

      // Set hash
      window.location.hash = '#data=compressed-data';

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(decompressSnapshot).toHaveBeenCalled();
      expect(importFromJson).toHaveBeenCalled();
    });

    it('shows error state when snapshot parse fails', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'bad-data' });
      (decompressSnapshot as Mock).mockReturnValue('{}');
      // importFromJson returns null => parse failure
      (importFromJson as Mock).mockReturnValue(null);

      window.location.hash = '#data=bad-data';

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load project')).toBeInTheDocument();
      });

      expect(screen.getByText(/Failed to decode shared snapshot/)).toBeInTheDocument();
    });

    it('shows error when snapshot decompression throws', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'bad-data' });
      (decompressSnapshot as Mock).mockImplementation(() => {
        throw new Error('Decompression failed');
      });

      window.location.hash = '#data=bad-data';

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load project')).toBeInTheDocument();
      });
    });

    it('shows error when importFromJson returns empty registers', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'empty-data' });
      (decompressSnapshot as Mock).mockReturnValue('{"registers":[]}');
      // Returns result with empty registers — treated as failure
      (importFromJson as Mock).mockReturnValue({ registers: [], values: {}, project: {} });

      window.location.hash = '#data=empty-data';

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load project')).toBeInTheDocument();
      });
    });
  });

  describe('cloud branch', () => {
    it('fetches cloud project and renders AppShell', async () => {
      const importResult = makeImportResult();
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc123' });
      (fetchAndParseCloudProject as Mock).mockResolvedValue(importResult);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(fetchAndParseCloudProject).toHaveBeenCalledWith('cloud-abc123', undefined);
    });

    it('passes isOwner from server response', async () => {
      const importResult = makeImportResult({ isOwner: true });
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc123' });
      (fetchAndParseCloudProject as Mock).mockResolvedValue(importResult);

      render(<AppLoader />);

      await waitFor(() => {
        const shell = screen.getByTestId('app-shell');
        expect(shell.dataset.isOwner).toBe('true');
        expect(shell.dataset.cloudId).toBe('cloud-abc123');
      });
    });

    it('sends JWT when available in localStorage', async () => {
      const importResult = makeImportResult({ isOwner: true });
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc123' });
      (fetchAndParseCloudProject as Mock).mockResolvedValue(importResult);

      localStorage.setItem('register-viewer-jwt', 'test-jwt-token');
      try {
        render(<AppLoader />);

        await waitFor(() => {
          expect(screen.getByTestId('app-shell')).toBeInTheDocument();
        });

        expect(fetchAndParseCloudProject).toHaveBeenCalledWith('cloud-abc123', 'test-jwt-token');
        expect(screen.getByTestId('app-shell').dataset.isOwner).toBe('true');
      } finally {
        localStorage.removeItem('register-viewer-jwt');
      }
    });

    it('shows error state when cloud fetch fails', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc123' });
      (fetchAndParseCloudProject as Mock).mockRejectedValue(new Error('Project not found'));

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load project')).toBeInTheDocument();
      });

      expect(screen.getByText('Project not found')).toBeInTheDocument();
    });

    it('shows generic error message for non-Error rejections', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc123' });
      (fetchAndParseCloudProject as Mock).mockRejectedValue('string error');

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load project')).toBeInTheDocument();
      });

      expect(screen.getByText('Failed to load project.')).toBeInTheDocument();
    });

    it('renders Continue button in error state', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc123' });
      (fetchAndParseCloudProject as Mock).mockRejectedValue(new Error('Fetch failed'));

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue to Register Viewer/i })).toBeInTheDocument();
      });
    });
  });

  describe('local branch', () => {
    it('loads local project and renders AppShell', async () => {
      const stored = makeStoredProject({ localId: 'local-abc' });
      (resolveInitialProject as Mock).mockReturnValue({ type: 'local', localId: 'local-abc' });
      (loadProject as Mock).mockReturnValue(stored);
      (deserializeState as Mock).mockReturnValue(TEST_APP_STATE);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(loadProject).toHaveBeenCalledWith('local-abc');
      expect(deserializeState).toHaveBeenCalledWith(stored.state);
    });

    it('passes localId to AppShell', async () => {
      const stored = makeStoredProject({ localId: 'local-abc' });
      (resolveInitialProject as Mock).mockReturnValue({ type: 'local', localId: 'local-abc' });
      (loadProject as Mock).mockReturnValue(stored);
      (deserializeState as Mock).mockReturnValue(TEST_APP_STATE);

      render(<AppLoader />);

      await waitFor(() => {
        const shell = screen.getByTestId('app-shell');
        expect(shell.dataset.localId).toBe('local-abc');
      });
    });

    it('includes cloudInit when stored project has a cloudId', async () => {
      const stored = makeStoredProject({ localId: 'local-abc', cloudId: 'cloud-xyz' });
      (resolveInitialProject as Mock).mockReturnValue({ type: 'local', localId: 'local-abc' });
      (loadProject as Mock).mockReturnValue(stored);
      (deserializeState as Mock).mockReturnValue(TEST_APP_STATE);

      render(<AppLoader />);

      await waitFor(() => {
        const shell = screen.getByTestId('app-shell');
        expect(shell.dataset.cloudId).toBe('cloud-xyz');
        // isOwner defaults to false; server re-evaluation promotes it after mount
        expect(shell.dataset.isOwner).toBe('false');
      });
    });

    it('falls back to unsaved seed when local project record is missing', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'local', localId: 'missing-id' });
      (loadProject as Mock).mockReturnValue(null); // project missing
      (createSeedRegisters as Mock).mockReturnValue([TEST_REGISTER]);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      // Should create an unsaved project, not a saved one
      expect(saveUnsavedProjectState).toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
      const shell = screen.getByTestId('app-shell');
      expect(shell.dataset.unsavedName).toBe('Example Project');
    });
  });

  describe('error state UI', () => {
    it('renders error heading and message', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'cloud', cloudId: 'cloud-abc123' });
      (fetchAndParseCloudProject as Mock).mockRejectedValue(new Error('Custom error message'));

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load project')).toBeInTheDocument();
        expect(screen.getByText('Custom error message')).toBeInTheDocument();
      });
    });

    it('renders warning icon SVG in error state', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'bad-data' });
      (importFromJson as Mock).mockReturnValue(null);

      const { container } = render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByText('Unable to load project')).toBeInTheDocument();
      });

      const svgs = container.querySelectorAll('svg');
      expect(svgs.length).toBeGreaterThan(0);
    });
  });

  describe('handleContinue callback', () => {
    it('clears hash and loads most recent project', async () => {
      // Start in error state
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'bad-data' });
      (importFromJson as Mock).mockReturnValue(null);

      // Most recent project exists
      const stored = makeStoredProject({ localId: 'recent-id' });
      (getMostRecentProjectId as Mock).mockReturnValue('recent-id');
      (loadProject as Mock).mockReturnValue(stored);
      (deserializeState as Mock).mockReturnValue(TEST_APP_STATE);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue to Register Viewer/i })).toBeInTheDocument();
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Continue to Register Viewer/i }));
      });

      // history.replaceState should be called to clear the hash
      expect(history.replaceState).toHaveBeenCalledWith(null, '', expect.stringMatching(/^[^#]/));

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(loadProject).toHaveBeenCalledWith('recent-id');
    });

    it('creates unsaved project when no most-recent project exists', async () => {
      // Start in error state
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'bad-data' });
      (importFromJson as Mock).mockReturnValue(null);

      // No most recent project
      (getMostRecentProjectId as Mock).mockReturnValue(null);
      (createSeedRegisters as Mock).mockReturnValue([TEST_REGISTER]);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue to Register Viewer/i })).toBeInTheDocument();
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Continue to Register Viewer/i }));
      });

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(saveUnsavedProjectState).toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
    });

    it('creates unsaved project when most-recent project record is missing', async () => {
      // Start in error state
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'bad-data' });
      (importFromJson as Mock).mockReturnValue(null);

      // Most recent ID exists but loadProject returns null (missing record)
      (getMostRecentProjectId as Mock).mockReturnValue('ghost-id');
      (loadProject as Mock).mockReturnValue(null);
      (createSeedRegisters as Mock).mockReturnValue([TEST_REGISTER]);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue to Register Viewer/i })).toBeInTheDocument();
      });

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Continue to Register Viewer/i }));
      });

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(saveUnsavedProjectState).toHaveBeenCalled();
      expect(createProject).not.toHaveBeenCalled();
    });

    it('calls runMigrationIfNeeded in handleContinue', async () => {
      // Start in error state
      (resolveInitialProject as Mock).mockReturnValue({ type: 'snapshot', data: 'bad-data' });
      (importFromJson as Mock).mockReturnValue(null);
      (getMostRecentProjectId as Mock).mockReturnValue(null);
      (createSeedRegisters as Mock).mockReturnValue([]);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Continue to Register Viewer/i })).toBeInTheDocument();
      });

      (runMigrationIfNeeded as Mock).mockClear();

      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Continue to Register Viewer/i }));
      });

      expect(runMigrationIfNeeded).toHaveBeenCalled();
    });
  });

  describe('AppProvider and AppShell integration', () => {
    it('renders AppShell inside AppProvider for ready state', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'create-default' });
      (createSeedRegisters as Mock).mockReturnValue([]);

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });
    });

    it('does not show loading spinner after state resolves', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'create-default' });

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(screen.queryByText('Loading project...')).not.toBeInTheDocument();
    });

    it('does not show error state after successful resolution', async () => {
      (resolveInitialProject as Mock).mockReturnValue({ type: 'create-default' });

      render(<AppLoader />);

      await waitFor(() => {
        expect(screen.getByTestId('app-shell')).toBeInTheDocument();
      });

      expect(screen.queryByText('Unable to load project')).not.toBeInTheDocument();
    });
  });
});
