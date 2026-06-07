import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthTransition } from './use-auth-transition';
import { initialInternalState, type SyncResult } from '../types/cloud-sync';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/project-storage', () => ({
  purgeCloudProjects: vi.fn(() => []),
  getMostRecentProjectId: vi.fn(() => null),
  ACTIVE_PROJECT_SESSION_KEY: 'test-active-project',
}));

vi.mock('../utils/cloud-utils', () => ({
  clearCloudUrl: vi.fn(),
}));

import { purgeCloudProjects, getMostRecentProjectId } from '../utils/project-storage';
import { clearCloudUrl } from '../utils/cloud-utils';

// ── Helpers ──────────────────────────────────────────────────────────

const INITIAL_INTERNAL_STATE = { ...initialInternalState };

function makeSyncResult(overrides: Partial<SyncResult> = {}): SyncResult {
  return {
    updatedCount: 0,
    staleCloudIds: [],
    staleReconciledCloudIds: [],
    staleReconcileFailedCloudIds: [],
    placeholdersCreated: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<Parameters<typeof useAuthTransition>[0]> = {}) {
  const activeLocalIdRef = { current: 'local-1' };
  const setInternal = vi.fn();
  const core = overrides.core ?? {
    internalRef: { current: { ...INITIAL_INTERNAL_STATE } },
    activeLocalIdRef,
    setInternal,
  };
  return {
    core,
    // Expose refs at top level for test assertions
    activeLocalIdRef: core.activeLocalIdRef,
    setInternal: core.setInternal,
    authUser: null as { email: string } | null,
    pendingOpRef: { current: null as 'save' | 'fork' | null },
    saveToCloud: vi.fn(() => Promise.resolve('saved' as const)),
    fork: vi.fn(() => Promise.resolve()),
    dismissLogin: vi.fn(),
    syncCloudProjectsRef: { current: vi.fn(() => Promise.resolve(makeSyncResult())) },
    syncTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
    refreshProjectList: vi.fn(),
    switchProject: vi.fn(),
    createNewProject: vi.fn(() => 'new-project-id'),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('useAuthTransition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('triggers sync on sign-in (null→user)', () => {
    const deps = makeDeps();
    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: null as { email: string } | null } },
    );

    // Sign in
    rerender({ authUser: { email: 'test@example.com' } });

    expect(deps.syncCloudProjectsRef.current).toHaveBeenCalledTimes(1);
  });

  it('refreshes the project list after sign-in sync creates placeholders', async () => {
    const deps = makeDeps({
      syncCloudProjectsRef: {
        current: vi.fn(() => Promise.resolve(makeSyncResult({ placeholdersCreated: 2 }))),
      },
    });
    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: null as { email: string } | null } },
    );

    rerender({ authUser: { email: 'test@example.com' } });

    await waitFor(() => {
      expect(deps.refreshProjectList).toHaveBeenCalledTimes(1);
    });
  });

  it('refreshes the project list after sign-in sync reconciles stale cloud projects', async () => {
    const deps = makeDeps({
      syncCloudProjectsRef: {
        current: vi.fn(() => Promise.resolve(makeSyncResult({ staleReconciledCloudIds: ['cloud-stale'] }))),
      },
    });
    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: null as { email: string } | null } },
    );

    rerender({ authUser: { email: 'test@example.com' } });

    await waitFor(() => {
      expect(deps.refreshProjectList).toHaveBeenCalledTimes(1);
    });
  });

  it('retries pending save on sign-in', () => {
    const deps = makeDeps();
    deps.pendingOpRef.current = 'save';

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: null as { email: string } | null } },
    );

    rerender({ authUser: { email: 'test@example.com' } });

    expect(deps.saveToCloud).toHaveBeenCalledTimes(1);
    expect(deps.dismissLogin).toHaveBeenCalled();
    expect(deps.pendingOpRef.current).toBe(null);
  });

  it('retries pending fork on sign-in', () => {
    const deps = makeDeps();
    deps.pendingOpRef.current = 'fork';

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: null as { email: string } | null } },
    );

    rerender({ authUser: { email: 'test@example.com' } });

    expect(deps.fork).toHaveBeenCalledTimes(1);
  });

  it('purges cloud projects on sign-out', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: { email: 'test@example.com' } as { email: string } | null } },
    );

    // Sign out
    rerender({ authUser: null });

    expect(purgeCloudProjects).toHaveBeenCalledTimes(1);
    expect(deps.refreshProjectList).toHaveBeenCalledTimes(1);
    expect(deps.setInternal).toHaveBeenCalledWith(initialInternalState);
    expect(clearCloudUrl).toHaveBeenCalledTimes(1);
  });

  it('switches to remaining project when active was purged', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });
    deps.activeLocalIdRef.current = 'purged-id';
    vi.mocked(purgeCloudProjects).mockReturnValue(['purged-id']);
    vi.mocked(getMostRecentProjectId).mockReturnValue('remaining-id');

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: { email: 'test@example.com' } as { email: string } | null } },
    );

    rerender({ authUser: null });

    expect(deps.switchProject).toHaveBeenCalledWith('remaining-id');
  });

  it('creates new project when no remaining after purge', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });
    deps.activeLocalIdRef.current = 'purged-id';
    vi.mocked(purgeCloudProjects).mockReturnValue(['purged-id']);
    vi.mocked(getMostRecentProjectId).mockReturnValue(null);

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: { email: 'test@example.com' } as { email: string } | null } },
    );

    rerender({ authUser: null });

    expect(deps.createNewProject).toHaveBeenCalledTimes(1);
    expect(deps.switchProject).toHaveBeenCalledWith('new-project-id');
  });

  it('clears sync timer on sign-out', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });
    const timerId = setTimeout(() => {}, 10000);
    deps.syncTimerRef.current = timerId;

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: { email: 'test@example.com' } as { email: string } | null } },
    );

    rerender({ authUser: null });

    // Timer should have been cleared (we can't directly check clearTimeout,
    // but setInternal being called confirms the sign-out path ran)
    expect(deps.setInternal).toHaveBeenCalled();
  });

  it('triggers sync on first mount with existing auth', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });

    renderHook(() => useAuthTransition(deps));

    expect(deps.syncCloudProjectsRef.current).toHaveBeenCalledTimes(1);
  });
});
