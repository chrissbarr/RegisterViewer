import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectSwitchEviction } from './use-project-switch-eviction';
import type { InternalCloudSyncState } from '../types/cloud-sync';
import { initialInternalState } from '../types/cloud-sync';
import type { ProjectListEntry } from '../types/project';
import { makeState, makeRegister } from '../test/helpers';

vi.mock('../utils/project-storage', () => ({
  buildProjectUrl: vi.fn((id: string) => `https://test.com/#/p/${id}`),
  evictProjectData: vi.fn(),
}));

vi.mock('../utils/cloud-url', () => ({
  setCloudUrl: vi.fn(),
  clearCloudUrl: vi.fn(),
}));

import { evictProjectData } from '../utils/project-storage';
import { clearCloudUrl } from '../utils/cloud-url';

function makeInternal(overrides: Partial<InternalCloudSyncState> = {}): InternalCloudSyncState {
  return { ...initialInternalState, ...overrides };
}

function makeProjectEntry(overrides: Partial<ProjectListEntry> & { localId: string }): ProjectListEntry {
  return {
    cloudId: null,
    name: 'Test Project',
    visibility: 'private',
    storage: 'local',
    createdAt: '2026-01-01T00:00:00Z',
    localSavedAt: '2026-01-01T00:00:00Z',
    cloudSavedAt: null,
    ...overrides,
  };
}

function makeDeps(overrides: Record<string, unknown> = {}) {
  const baseState = makeState({ registers: [makeRegister()] });
  const internal = makeInternal();

  return {
    activeLocalId: 'proj-1' as string | null,
    appState: baseState,
    projects: [] as ProjectListEntry[],
    internalRef: { current: internal },
    projectsRef: { current: [] as ProjectListEntry[] },
    activeLocalIdRef: { current: 'proj-1' as string | null },
    needsVersionSyncRef: { current: false },
    lastStableStateRef: { current: { localId: 'proj-1', state: baseState } },
    flushSyncRef: { current: vi.fn().mockResolvedValue(undefined) },
    syncTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
    isSigningOutRef: { current: false },
    cancelPendingOp: vi.fn(),
    setInternal: vi.fn(),
    initialInternalState,
    ...overrides,
  };
}

describe('useProjectSwitchEviction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not evict on initial mount', () => {
    const deps = makeDeps();
    renderHook(() => useProjectSwitchEviction(deps));
    expect(evictProjectData).not.toHaveBeenCalled();
  });

  it('clears cloud state when switching to null activeLocalId', () => {
    const setInternal = vi.fn();
    const cancelPendingOp = vi.fn();
    const syncTimerRef = { current: setTimeout(() => {}, 10000) };

    const deps = makeDeps({
      activeLocalId: 'proj-1',
      setInternal,
      cancelPendingOp,
      syncTimerRef,
    });

    const { rerender } = renderHook(
      (props) => useProjectSwitchEviction(props),
      { initialProps: deps },
    );

    // Switch to null
    rerender({ ...deps, activeLocalId: null, activeLocalIdRef: { current: null } });

    expect(cancelPendingOp).toHaveBeenCalled();
    expect(clearCloudUrl).toHaveBeenCalled();
    expect(setInternal).toHaveBeenCalledWith({ ...initialInternalState });
  });

  it('does not evict local-storage projects on switch', async () => {
    const projects = [
      makeProjectEntry({ localId: 'proj-1', storage: 'local' }),
      makeProjectEntry({ localId: 'proj-2', storage: 'local' }),
    ];
    const deps = makeDeps({
      activeLocalId: 'proj-1',
      projects,
      projectsRef: { current: projects },
    });

    const { rerender } = renderHook(
      (props) => useProjectSwitchEviction(props),
      { initialProps: deps },
    );

    rerender({ ...deps, activeLocalId: 'proj-2', activeLocalIdRef: { current: 'proj-2' } });

    // Let any pending promises flush
    await vi.waitFor(() => {
      expect(evictProjectData).not.toHaveBeenCalled();
    });
  });

  it('skips eviction during sign-out', async () => {
    const flushSync = vi.fn().mockResolvedValue(undefined);
    const projects = [
      makeProjectEntry({ localId: 'proj-1', cloudId: 'cloud-1', storage: 'cloud' }),
      makeProjectEntry({ localId: 'proj-2', storage: 'local' }),
    ];
    const isSigningOutRef = { current: false };
    const deps = makeDeps({
      activeLocalId: 'proj-1',
      projects,
      projectsRef: { current: projects },
      flushSyncRef: { current: flushSync },
      isSigningOutRef,
    });

    const { rerender } = renderHook(
      (props) => useProjectSwitchEviction(props),
      { initialProps: deps },
    );

    // Set signing out before the switch
    isSigningOutRef.current = true;
    rerender({
      ...deps,
      activeLocalId: 'proj-2',
      activeLocalIdRef: { current: 'proj-2' },
      isSigningOutRef,
    });

    await vi.waitFor(() => {
      expect(flushSync).toHaveBeenCalled();
    });

    expect(evictProjectData).not.toHaveBeenCalled();
  });
});
