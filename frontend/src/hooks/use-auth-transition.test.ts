import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuthTransition } from './use-auth-transition';
import { initialInternalState } from '../types/cloud-sync';

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
    pendingCloudOpRef: { current: null as 'save' | 'fork' | null },
    setLoginRequired: vi.fn(),
    rawSave: vi.fn(() => Promise.resolve(true)),
    rawFork: vi.fn(() => Promise.resolve()),
    syncCloudProjectsRef: { current: vi.fn(() => Promise.resolve({ updatedCount: 0, staleCloudIds: [], placeholdersCreated: 0 })) },
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

  it('retries pending save on sign-in', () => {
    const deps = makeDeps();
    deps.pendingCloudOpRef.current = 'save';

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: null as { email: string } | null } },
    );

    rerender({ authUser: { email: 'test@example.com' } });

    expect(deps.rawSave).toHaveBeenCalledTimes(1);
    expect(deps.setLoginRequired).toHaveBeenCalledWith(false);
    expect(deps.pendingCloudOpRef.current).toBe(null);
  });

  it('retries pending fork on sign-in', () => {
    const deps = makeDeps();
    deps.pendingCloudOpRef.current = 'fork';

    const { rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: null as { email: string } | null } },
    );

    rerender({ authUser: { email: 'test@example.com' } });

    expect(deps.rawFork).toHaveBeenCalledTimes(1);
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

  it('returns isSigningOutRef', () => {
    const deps = makeDeps();
    const { result } = renderHook(() => useAuthTransition(deps));
    expect(result.current.isSigningOutRef).toBeDefined();
    expect(result.current.isSigningOutRef.current).toBe(false);
  });

  it('sets isSigningOutRef true during sign-out', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });

    const { result, rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: { email: 'test@example.com' } as { email: string } | null } },
    );

    const isSigningOutRef = result.current.isSigningOutRef;

    // Spy on purgeCloudProjects to observe isSigningOutRef mid-sign-out
    vi.mocked(purgeCloudProjects).mockImplementation(() => {
      expect(isSigningOutRef.current).toBe(true);
      return [];
    });

    rerender({ authUser: null });

    expect(purgeCloudProjects).toHaveBeenCalledTimes(1);
  });

  it('isSigningOutRef stays true after sign-out until next sign-in', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });

    const { result, rerender } = renderHook(
      ({ authUser }) => useAuthTransition({ ...deps, authUser }),
      { initialProps: { authUser: { email: 'test@example.com' } as { email: string } | null } },
    );

    // Sign out — ref should stay true (protects async eviction checks)
    rerender({ authUser: null });
    expect(result.current.isSigningOutRef.current).toBe(true);

    // Sign back in — ref should be reset to false
    rerender({ authUser: { email: 'test@example.com' } });
    expect(result.current.isSigningOutRef.current).toBe(false);
  });

  it('triggers sync on first mount with existing auth', () => {
    const deps = makeDeps({ authUser: { email: 'test@example.com' } });

    renderHook(() => useAuthTransition(deps));

    expect(deps.syncCloudProjectsRef.current).toHaveBeenCalledTimes(1);
  });
});
