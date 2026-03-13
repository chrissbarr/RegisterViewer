import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectSwitchEviction } from './use-project-switch-eviction';
import type { InternalCloudSyncState, CloudSyncCore } from '../types/cloud-sync';
import { initialInternalState } from '../types/cloud-sync';
import type { ProjectListEntry } from '../types/project';
import { makeState, makeRegister } from '../test/helpers';

vi.mock('../utils/project-storage', () => ({
  buildProjectUrl: vi.fn((id: string) => `https://test.com/#/p/${id}`),
  evictProjectData: vi.fn(),
}));

vi.mock('../utils/cloud-utils', () => ({
  setCloudUrl: vi.fn(),
  clearCloudUrl: vi.fn(),
}));

import { evictProjectData } from '../utils/project-storage';
import { clearCloudUrl, setCloudUrl } from '../utils/cloud-utils';

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

type Deps = Parameters<typeof useProjectSwitchEviction>[0];

interface MakeDepsOverrides extends Partial<Omit<Deps, 'core'>> {
  internalRef?: { current: InternalCloudSyncState };
  setInternal?: ReturnType<typeof vi.fn>;
}

function makeDeps(overrides: MakeDepsOverrides = {}) {
  const baseState = makeState({ registers: [makeRegister()] });
  const internal = makeInternal();

  const internalRef = overrides.internalRef ?? { current: internal };
  const activeLocalIdRef = { current: 'proj-1' as string | null };
  const setInternal = overrides.setInternal ?? vi.fn();
  const core = { internalRef, activeLocalIdRef, setInternal, initialInternalState } as unknown as CloudSyncCore;

  // Remove core-field overrides before spreading into Deps
  const { internalRef: _, setInternal: __, ...rest } = overrides;

  return {
    core,
    // Expose core fields at top level for test assertions
    internalRef,
    activeLocalIdRef,
    setInternal,
    activeLocalId: 'proj-1' as string | null,
    appState: baseState,
    projects: [] as ProjectListEntry[],
    projectsRef: { current: [] as ProjectListEntry[] },
    needsVersionSyncRef: { current: false },
    lastStableStateRef: { current: { localId: 'proj-1' as string | null, state: baseState } },
    flushSyncRef: { current: vi.fn().mockResolvedValue(undefined) as ((stateOverride?: unknown) => Promise<void>) | null },
    syncTimerRef: { current: null as ReturnType<typeof setTimeout> | null },
    isSigningOutRef: { current: false },
    cancelPendingOp: vi.fn(),
    ...rest,
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

    // Switch to null — mutate the ref to match what the provider does
    deps.activeLocalIdRef.current = null;
    rerender({ ...deps, activeLocalId: null });

    expect(cancelPendingOp).toHaveBeenCalled();
    expect(clearCloudUrl).toHaveBeenCalled();
    expect(setInternal).toHaveBeenCalledWith(initialInternalState);
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

    deps.activeLocalIdRef.current = 'proj-2';
    rerender({ ...deps, activeLocalId: 'proj-2' });

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
    deps.activeLocalIdRef.current = 'proj-2';
    rerender({
      ...deps,
      activeLocalId: 'proj-2',
      isSigningOutRef,
    });

    await vi.waitFor(() => {
      expect(flushSync).toHaveBeenCalled();
    });

    expect(evictProjectData).not.toHaveBeenCalled();
  });

  it('evicts cloud project data on switch', async () => {
    const flushSync = vi.fn().mockResolvedValue(undefined);
    const projects = [
      makeProjectEntry({ localId: 'proj-1', cloudId: 'cloud-1', storage: 'cloud' }),
      makeProjectEntry({ localId: 'proj-2', storage: 'local' }),
    ];
    const deps = makeDeps({
      activeLocalId: 'proj-1',
      projects,
      projectsRef: { current: projects },
      flushSyncRef: { current: flushSync },
    });

    const { rerender } = renderHook(
      (props) => useProjectSwitchEviction(props),
      { initialProps: deps },
    );

    deps.activeLocalIdRef.current = 'proj-2';
    rerender({
      ...deps,
      activeLocalId: 'proj-2',
    });

    await vi.waitFor(() => {
      expect(evictProjectData).toHaveBeenCalledWith('proj-1');
    });

    expect(flushSync).toHaveBeenCalled();
  });

  it('updates cloud state when switching to project with cloudId', () => {
    const setInternal = vi.fn();
    const projects = [
      makeProjectEntry({ localId: 'proj-1', storage: 'local' }),
      makeProjectEntry({ localId: 'proj-2', cloudId: 'cloud-2', storage: 'cloud', visibility: 'unlisted' }),
    ];
    const needsVersionSyncRef = { current: false };
    const deps = makeDeps({
      activeLocalId: 'proj-1',
      projects,
      projectsRef: { current: projects },
      internalRef: { current: makeInternal({ cloudId: null }) },
      needsVersionSyncRef,
      setInternal,
    });

    const { rerender } = renderHook(
      (props) => useProjectSwitchEviction(props),
      { initialProps: deps },
    );

    deps.activeLocalIdRef.current = 'proj-2';
    rerender({
      ...deps,
      activeLocalId: 'proj-2',
    });

    expect(setCloudUrl).toHaveBeenCalledWith('cloud-2');
    expect(setInternal).toHaveBeenCalledWith(expect.any(Function));
    expect(needsVersionSyncRef.current).toBe(true);
  });
});
