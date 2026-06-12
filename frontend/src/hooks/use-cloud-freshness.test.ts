import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { checkAndPullFreshVersion, type FreshnessCheckContext } from './use-cloud-freshness';
import type { FreshnessCheckCall } from '../utils/cloud-freshness';
import { initialInternalState, type InternalCloudSyncState } from '../types/cloud-sync';
import { cleanBaseline, type CloudSyncAction } from '../utils/cloud-sync-reducer';
import type { ProjectStorageWriteResult } from '../utils/project-storage';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../utils/api-client', () => ({
  getProject: vi.fn(),
  getProjectMeta: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    errorBody: Record<string, unknown>;
    constructor(status: number, errorBody: Record<string, unknown>) {
      super(String(errorBody.error));
      this.name = 'ApiError';
      this.status = status;
      this.errorBody = errorBody;
    }
  },
}));

vi.mock('../utils/cloud-project-loader', () => ({
  parseProjectData: vi.fn(),
}));

vi.mock('../utils/project-storage', () => ({
  patchProjectState: vi.fn(),
  loadProject: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  serializeState: vi.fn((state: unknown) => state),
  deserializeState: vi.fn((state: unknown) => state),
}));

import { getProject, getProjectMeta, ApiError } from '../utils/api-client';
import { parseProjectData } from '../utils/cloud-project-loader';
import { patchProjectState, loadProject } from '../utils/project-storage';
import { deserializeState } from '../utils/storage';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_CLOUD_ID = 'cloud-abc';
const TEST_LOCAL_ID = 'local-123';
const TEST_JWT = 'mock-jwt';

function writeOk(): ProjectStorageWriteResult {
  return { ok: true, status: 'ok', evictedLocalIds: [] };
}

function makeInternalState(overrides: Partial<InternalCloudSyncState> = {}): InternalCloudSyncState {
  return { ...initialInternalState, cloudId: TEST_CLOUD_ID, baseline: cleanBaseline(5), serverVersion: 1, ...overrides };
}

function makeCtx(overrides: Partial<FreshnessCheckContext> = {}): FreshnessCheckContext {
  return {
    internalRef: { current: makeInternalState() },
    activeLocalIdRef: { current: TEST_LOCAL_ID }, // matches makeCall's localId => identity passes
    dataVersionRef: { current: 5 }, // matches clean baseline => not dirty
    dispatch: vi.fn(),
    lastFreshnessCheckRef: { current: 0 }, // never checked before
    updateCloudMetadata: vi.fn(() => writeOk()),
    cloudDispatch: vi.fn(),
    ...overrides,
  };
}

/**
 * True when one of the cloud dispatches requested a baseline capture
 * (REQUEST_BASELINE, S14a).
 */
function requestedBaselineCapture(cloudDispatch: Mock): boolean {
  return cloudDispatch.mock.calls.some((call) => (call[0] as CloudSyncAction).type === 'REQUEST_BASELINE');
}

function makeCall(overrides: Partial<FreshnessCheckCall> = {}): FreshnessCheckCall {
  return {
    cloudId: TEST_CLOUD_ID,
    knownVersion: 1,
    localId: TEST_LOCAL_ID,
    jwt: TEST_JWT,
    ...overrides,
  };
}

const PARSED_DATA = {
  registers: [{ id: 'r1', name: 'STATUS', width: 32, fields: [] }],
  values: { r1: 0xFFn },
  project: { title: 'Test' },
  addressUnitBits: 8,
};

// ── Setup ────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  (patchProjectState as Mock).mockReturnValue(writeOk());
  // Default the /meta probe to 404 so pre-probe tests exercise the permanent
  // deploy-skew fallback (probe 404 → full GET) and keep their original
  // single-getProject assertions unchanged. Probe-specific tests override this.
  (getProjectMeta as Mock).mockRejectedValue(new ApiError(404, { error: 'Project not found' }));
});

// ── Tests ────────────────────────────────────────────────────────────

describe('checkAndPullFreshVersion (effectful shim)', () => {
  it('pulls fresh version when server has newer version', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3, // newer than knownVersion (1)
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    await checkAndPullFreshVersion(ctx, call);

    expect(getProject).toHaveBeenCalledTimes(1);
    expect(getProject).toHaveBeenCalledWith(TEST_CLOUD_ID, TEST_JWT);
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'IMPORT_STATE',
      registers: PARSED_DATA.registers,
      values: PARSED_DATA.values,
      project: PARSED_DATA.project,
      addressUnitBits: PARSED_DATA.addressUnitBits,
    });
    expect(patchProjectState).toHaveBeenCalledWith(TEST_LOCAL_ID, expect.anything());
    expect(requestedBaselineCapture(ctx.cloudDispatch as Mock)).toBe(true);
    expect(ctx.cloudDispatch).toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
      cloudSavedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      serverVersion: 3,
      cloudConflictVersion: null,
      hasUnsyncedChanges: false,
    });
  });

  it('skips when server version equals known version (cache is fresh)', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 2 });
    (getProject as Mock).mockResolvedValue({
      data: {},
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 2, // same as knownVersion
    });

    await checkAndPullFreshVersion(ctx, call);

    expect(getProject).toHaveBeenCalledTimes(1);
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).not.toHaveBeenCalled();
  });

  it('skips when server version is less than known version', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 5 });
    (getProject as Mock).mockResolvedValue({
      data: {},
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3, // less than knownVersion
    });

    await checkAndPullFreshVersion(ctx, call);

    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('skips when project is dirty (user has edited)', async () => {
    const ctx = makeCtx({
      dataVersionRef: { current: 10 }, // different from clean baseline (5)
    });
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: {},
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3, // newer
    });

    await checkAndPullFreshVersion(ctx, call);

    expect(getProject).not.toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('skips when throttled (second call within 30s)', async () => {
    const ctx = makeCtx({
      lastFreshnessCheckRef: { current: Date.now() - 5_000 }, // 5 seconds ago
    });
    const call = makeCall();

    await checkAndPullFreshVersion(ctx, call);

    expect(getProject).not.toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('replace-with-server bypasses throttle, version check, and isDirty guard', async () => {
    const ctx = makeCtx({
      lastFreshnessCheckRef: { current: Date.now() - 1_000 }, // recent = throttled
      dataVersionRef: { current: 10 }, // dirty
    });
    const call = makeCall({
      knownVersion: 5,
      mode: 'replace-with-server',
    });
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3, // less than knownVersion (would normally skip)
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    await checkAndPullFreshVersion(ctx, call);

    // Should pull despite throttle, stale version, and dirty state
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'IMPORT_STATE',
      registers: PARSED_DATA.registers,
      values: PARSED_DATA.values,
      project: PARSED_DATA.project,
      addressUnitBits: PARSED_DATA.addressUnitBits,
    });
    expect(ctx.updateCloudMetadata).toHaveBeenCalled();
  });

  it('pull-if-clean bypasses throttle and version check but refuses dirty overwrite', async () => {
    const ctx = makeCtx({
      lastFreshnessCheckRef: { current: Date.now() - 1_000 },
      dataVersionRef: { current: 10 },
    });
    const call = makeCall({
      knownVersion: 5,
      mode: 'pull-if-clean',
      expectedDataVersion: 5,
    });

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'dirty' });
    expect(getProject).not.toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
  });

  it('pull-if-clean aborts when user edits during the fetch', async () => {
    const ctx = makeCtx();
    const call = makeCall({
      knownVersion: 5,
      mode: 'pull-if-clean',
      expectedDataVersion: 5,
    });
    (getProject as Mock).mockImplementation(async () => {
      ctx.dataVersionRef.current = 6;
      return {
        data: { version: 1, registers: [], registerValues: {} },
        updatedAt: '2024-06-01T00:00:00Z',
        visibility: 'private',
        version: 3,
      };
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'dirty', serverVersion: 3 });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(patchProjectState).not.toHaveBeenCalled();
  });

  it('pulls into memory without localStorage writes when no localId exists', async () => {
    // Unsaved shared-project viewer: no active local project either (the
    // BR-3 identity gate matches null call.localId against a null live localId).
    const ctx = makeCtx({ activeLocalIdRef: { current: null } });
    const call = makeCall({ localId: null, mode: 'replace-with-server' });
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: true, serverVersion: 3 });
    expect(ctx.dispatch).toHaveBeenCalledWith({
      type: 'IMPORT_STATE',
      registers: PARSED_DATA.registers,
      values: PARSED_DATA.values,
      project: PARSED_DATA.project,
      addressUnitBits: PARSED_DATA.addressUnitBits,
    });
    expect(patchProjectState).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).not.toHaveBeenCalled();
    expect(requestedBaselineCapture(ctx.cloudDispatch as Mock)).toBe(true);
  });

  it('calls getProject exactly once (single-fetch pattern)', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    await checkAndPullFreshVersion(ctx, call);

    expect(getProject).toHaveBeenCalledTimes(1);
  });

  it('does not update state when parseProjectData returns null', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: 'invalid-data',
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(null);

    await checkAndPullFreshVersion(ctx, call);

    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(patchProjectState).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).not.toHaveBeenCalled();
  });

  it('does not dispatch or update metadata when local payload persistence fails', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);
    (patchProjectState as Mock).mockReturnValue({
      ok: false,
      status: 'quota-exceeded',
      evictedLocalIds: ['cached-cloud'],
    });

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'local-persist-failed', serverVersion: 3 });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(requestedBaselineCapture(ctx.cloudDispatch as Mock)).toBe(false);
    expect(ctx.cloudDispatch).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).not.toHaveBeenCalled();
  });

  it('does not dispatch or mark internal state fresh when metadata persistence fails', async () => {
    const ctx = makeCtx({
      updateCloudMetadata: vi.fn((): ProjectStorageWriteResult => ({
        ok: false,
        status: 'quota-exceeded',
        evictedLocalIds: [],
      })),
    });
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'local-persist-failed', serverVersion: 3 });
    expect(patchProjectState).toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(requestedBaselineCapture(ctx.cloudDispatch as Mock)).toBe(false);
    expect(ctx.cloudDispatch).not.toHaveBeenCalled();
  });

  it('preserves existing UI fields (mapTableWidth, mapShowGaps, etc.) during pull', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    // Mock existing project with custom UI state
    (loadProject as Mock).mockReturnValue({
      localId: TEST_LOCAL_ID,
      state: {
        registers: [],
        activeRegisterId: 'REG_X',
        registerValues: {},
        mapTableWidth: 64,
        mapShowGaps: false,
        mapSortDescending: true,
      },
    });
    (deserializeState as Mock).mockReturnValue({
      registers: [],
      activeRegisterId: 'REG_X',
      registerValues: {},
      mapTableWidth: 64,
      mapShowGaps: false,
      mapSortDescending: true,
    });

    await checkAndPullFreshVersion(ctx, call);

    expect(patchProjectState).toHaveBeenCalledWith(
      TEST_LOCAL_ID,
      expect.objectContaining({
        activeRegisterId: 'REG_X',
        mapTableWidth: 64,
        mapShowGaps: false,
        mapSortDescending: true,
      }),
    );
  });

  it('falls back to defaults when no existing project data', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);
    (loadProject as Mock).mockReturnValue(null);

    await checkAndPullFreshVersion(ctx, call);

    expect(patchProjectState).toHaveBeenCalledWith(
      TEST_LOCAL_ID,
      expect.objectContaining({
        activeRegisterId: 'r1', // first register ID from PARSED_DATA
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
      }),
    );
  });

  it('updates lastFreshnessCheckRef timestamp', async () => {
    const ctx = makeCtx({
      lastFreshnessCheckRef: { current: 0 },
    });
    const call = makeCall();
    (getProject as Mock).mockResolvedValue({
      data: {},
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 1, // same as known — won't pull but still updates timestamp
    });

    const before = Date.now();
    await checkAndPullFreshVersion(ctx, call);
    const after = Date.now();

    expect(ctx.lastFreshnessCheckRef.current).toBeGreaterThanOrEqual(before);
    expect(ctx.lastFreshnessCheckRef.current).toBeLessThanOrEqual(after);
  });
});

// ── /meta probe (P6) ─────────────────────────────────────────────────

function makeMetaResponse(version: number) {
  return {
    id: TEST_CLOUD_ID,
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    isOwner: true,
    authenticated: true,
    visibility: 'private' as const,
    version,
  };
}

describe('checkAndPullFreshVersion — /meta probe', () => {
  it('skips the full fetch when the probe version is not newer (fresh)', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 2 });
    (getProjectMeta as Mock).mockResolvedValue(makeMetaResponse(2));

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'fresh', serverVersion: 2 });
    expect(getProjectMeta).toHaveBeenCalledTimes(1);
    expect(getProjectMeta).toHaveBeenCalledWith(TEST_CLOUD_ID, TEST_JWT);
    expect(getProject).not.toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).not.toHaveBeenCalled();
  });

  it('falls through to the full fetch and pulls when the probe version is newer', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 1 });
    (getProjectMeta as Mock).mockResolvedValue(makeMetaResponse(3));
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: true, serverVersion: 3 });
    expect(getProjectMeta).toHaveBeenCalledTimes(1);
    expect(getProject).toHaveBeenCalledTimes(1);
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'IMPORT_STATE' }));
  });

  it('pull-if-clean skips the probe entirely (single fetch stays optimal)', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 5, mode: 'pull-if-clean', expectedDataVersion: 5 });
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    await checkAndPullFreshVersion(ctx, call);

    expect(getProjectMeta).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalledTimes(1);
  });

  it('replace-with-server skips the probe entirely', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 5, mode: 'replace-with-server' });
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    await checkAndPullFreshVersion(ctx, call);

    expect(getProjectMeta).not.toHaveBeenCalled();
    expect(getProject).toHaveBeenCalledTimes(1);
  });

  it('dirty pre-gate blocks both the probe and the full fetch', async () => {
    const ctx = makeCtx({
      dataVersionRef: { current: 10 }, // diverged from clean baseline (5)
    });
    const call = makeCall();

    await checkAndPullFreshVersion(ctx, call);

    expect(getProjectMeta).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
  });

  it('refuses to overwrite an edit that lands between the probe and the full fetch', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 1 });
    (getProjectMeta as Mock).mockImplementation(async () => {
      // Edit lands during the probe round-trip — the post-fetch two-phase
      // dirty re-check must also cover the probe window.
      ctx.dataVersionRef.current = 6;
      return makeMetaResponse(3);
    });
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'dirty', serverVersion: 3 });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(patchProjectState).not.toHaveBeenCalled();
  });

  it('falls back to the full fetch when the probe 404s (deploy-skew funnel)', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 1 });
    (getProjectMeta as Mock).mockRejectedValue(new ApiError(404, { error: 'Not found' }));
    (getProject as Mock).mockResolvedValue({
      data: { version: 1, registers: [], registerValues: {} },
      updatedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      version: 3,
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: true, serverVersion: 3 });
    expect(getProjectMeta).toHaveBeenCalledTimes(1);
    expect(getProject).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-404 probe failure without falling back', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 1 });
    (getProjectMeta as Mock).mockRejectedValue(new ApiError(500, { error: 'Server error' }));

    await expect(checkAndPullFreshVersion(ctx, call)).rejects.toThrow('Server error');
    expect(getProject).not.toHaveBeenCalled();
  });
});

// ── Project switch during the check (BR-3 identity gate) ────────────

/**
 * Mirrors the real switch-to-B sequence: `cloudStateForEntry` seeds a CLEAN
 * baseline at the current generation synchronously at switch time, and the
 * active localId ref flips to the new project.
 */
function switchLiveProject(ctx: FreshnessCheckContext, cloudId: string | null): void {
  ctx.internalRef.current = makeInternalState({
    cloudId,
    baseline: cleanBaseline(ctx.dataVersionRef.current),
  });
  ctx.activeLocalIdRef.current = 'local-B';
}

describe('checkAndPullFreshVersion — project switch mid-check (BR-3)', () => {
  const SERVER_RESPONSE = {
    data: { version: 1, registers: [], registerValues: {} },
    updatedAt: '2024-06-01T00:00:00Z',
    visibility: 'private',
    version: 3,
  };

  it('refuses the live import when the user switches to another cloud project mid-fetch, but persists to the captured localId', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockImplementation(async () => {
      switchLiveProject(ctx, 'cloud-B'); // clean baseline at current generation
      return SERVER_RESPONSE;
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'switched-project', serverVersion: 3 });
    // No IMPORT_STATE into project B's live workspace…
    expect(ctx.dispatch).not.toHaveBeenCalled();
    // …and no REQUEST_BASELINE / APPLY_PULL onto B's cloud state.
    expect(ctx.cloudDispatch).not.toHaveBeenCalled();
    // The persist is still keyed to the CAPTURED A localId: A's record and
    // manifest serverVersion stay consistent (switch-back won't re-pull).
    expect(patchProjectState).toHaveBeenCalledWith(TEST_LOCAL_ID, expect.anything());
    expect(ctx.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, {
      cloudSavedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      serverVersion: 3,
      cloudConflictVersion: null,
      hasUnsyncedChanges: false,
    });
  });

  it('refuses the live import after a cloud-to-local switch mid-fetch', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockImplementation(async () => {
      switchLiveProject(ctx, null); // new active project is local-only
      return SERVER_RESPONSE;
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'switched-project', serverVersion: 3 });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.cloudDispatch).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, expect.anything());
  });

  it('replace-with-server refuses when the project switches mid-fetch — even over a DIRTY new project (conflict-Load hole)', async () => {
    const ctx = makeCtx();
    const call = makeCall({ knownVersion: 5, mode: 'replace-with-server' });
    (getProject as Mock).mockImplementation(async () => {
      // Switch to a DIRTY project B: allowDirtyOverwrite would bypass the
      // dirty gate, so only the identity gate stands between A's payload and
      // B's workspace.
      ctx.internalRef.current = makeInternalState({ cloudId: 'cloud-B', baseline: cleanBaseline(0) });
      ctx.activeLocalIdRef.current = 'local-B';
      ctx.dataVersionRef.current = 10; // diverged from baseline => dirty
      return SERVER_RESPONSE;
    });
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'switched-project', serverVersion: 3 });
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.cloudDispatch).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).toHaveBeenCalledWith(TEST_LOCAL_ID, expect.anything());
  });

  it('refuses pre-fetch (no probe, no GET) when identity already mismatches at call time', async () => {
    const ctx = makeCtx({ activeLocalIdRef: { current: 'local-B' } });
    const call = makeCall();

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: false, reason: 'switched-project' });
    expect(getProjectMeta).not.toHaveBeenCalled();
    expect(getProject).not.toHaveBeenCalled();
    expect(ctx.dispatch).not.toHaveBeenCalled();
    expect(ctx.cloudDispatch).not.toHaveBeenCalled();
    expect(ctx.updateCloudMetadata).not.toHaveBeenCalled();
  });

  it('same-project pull still applies when no switch happens (pin)', async () => {
    const ctx = makeCtx();
    const call = makeCall();
    (getProject as Mock).mockResolvedValue(SERVER_RESPONSE);
    (parseProjectData as Mock).mockReturnValue(PARSED_DATA);

    const result = await checkAndPullFreshVersion(ctx, call);

    expect(result).toEqual({ applied: true, serverVersion: 3 });
    expect(ctx.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'IMPORT_STATE' }));
  });
});
