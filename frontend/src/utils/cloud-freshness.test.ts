import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import {
  decideFreshnessPull,
  probeIndicatesFresh,
  type FreshnessDecisionState,
  type FreshnessCheckCall,
} from './cloud-freshness';
import { cleanBaseline } from './cloud-sync-reducer';
import type { GetProjectResponse } from './api-client';

// ── Mocks ────────────────────────────────────────────────────────────
// `decideFreshnessPull` parses the server payload via parseProjectData; mock it
// so the pure decision is driven by a primitive (parsed vs null).

vi.mock('./cloud-project-loader', () => ({
  parseProjectData: vi.fn(),
}));

import { parseProjectData } from './cloud-project-loader';

// ── Helpers ──────────────────────────────────────────────────────────

const TEST_CLOUD_ID = 'cloud-abc';
const TEST_LOCAL_ID = 'local-123';
const TEST_JWT = 'mock-jwt';

const PARSED_DATA = {
  registers: [{ id: 'r1', name: 'STATUS', width: 32, fields: [] }],
  values: { r1: 0xFFn },
  project: { title: 'Test' },
  addressUnitBits: 8,
};

/** Baseline decision state: clean (dataVersion === baseline), never checked, identity matching. */
function makeState(overrides: Partial<FreshnessDecisionState> = {}): FreshnessDecisionState {
  return {
    now: 1_000_000,
    lastCheck: 0,
    dataVersion: 5,
    baseline: cleanBaseline(5),
    liveCloudId: TEST_CLOUD_ID,
    liveLocalId: TEST_LOCAL_ID,
    ...overrides,
  };
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

function makeServerResponse(overrides: Partial<GetProjectResponse> = {}): GetProjectResponse {
  return {
    id: TEST_CLOUD_ID,
    data: { version: 1, registers: [], registerValues: {} },
    createdAt: '2024-06-01T00:00:00Z',
    updatedAt: '2024-06-01T00:00:00Z',
    isOwner: true,
    visibility: 'private',
    version: 3, // newer than knownVersion (1) by default
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (parseProjectData as Mock).mockReturnValue(PARSED_DATA);
});

// ── Pre-fetch gate ───────────────────────────────────────────────────

describe('decideFreshnessPull — pre-fetch gate', () => {
  it('returns null (proceed) when clean, un-throttled, and no expected version mismatch', () => {
    expect(decideFreshnessPull(makeState(), makeCall())).toBeNull();
  });

  it('throttles a second call within 30s', () => {
    const state = makeState({ now: 1_005_000, lastCheck: 1_000_000 }); // 5s ago
    expect(decideFreshnessPull(state, makeCall())).toEqual({ kind: 'throttled' });
  });

  it('does not throttle once 30s have elapsed', () => {
    const state = makeState({ now: 1_031_000, lastCheck: 1_000_000 }); // 31s ago
    expect(decideFreshnessPull(state, makeCall())).toBeNull();
  });

  it('reports dirty (phase 1) when dataVersion diverges from baseline', () => {
    const state = makeState({ dataVersion: 10, baseline: cleanBaseline(5) });
    expect(decideFreshnessPull(state, makeCall())).toEqual({ kind: 'dirty' });
  });

  it('reports changed-during-pull (phase 1) when expectedDataVersion no longer matches', () => {
    // dataVersion === baseline (not dirty) but diverges from expectedDataVersion.
    const state = makeState({ dataVersion: 6, baseline: cleanBaseline(6) });
    const call = makeCall({ expectedDataVersion: 5 });
    expect(decideFreshnessPull(state, call)).toEqual({ kind: 'changed-during-pull' });
  });

  it('replace-with-server bypasses throttle and the dirty gate pre-fetch', () => {
    const state = makeState({ now: 1_001_000, lastCheck: 1_000_000, dataVersion: 10, baseline: cleanBaseline(5) });
    const call = makeCall({ mode: 'replace-with-server' });
    expect(decideFreshnessPull(state, call)).toBeNull();
  });

  it('pull-if-clean bypasses throttle but still refuses a dirty overwrite pre-fetch', () => {
    const state = makeState({ now: 1_001_000, lastCheck: 1_000_000, dataVersion: 10, baseline: cleanBaseline(5) });
    const call = makeCall({ mode: 'pull-if-clean', expectedDataVersion: 5 });
    expect(decideFreshnessPull(state, call)).toEqual({ kind: 'dirty' });
  });
});

// ── Post-fetch decision ──────────────────────────────────────────────

describe('decideFreshnessPull — post-fetch decision', () => {
  it('pulls when the server has a newer version', () => {
    const decision = decideFreshnessPull(makeState(), makeCall(), makeServerResponse({ version: 3 }));
    expect(decision).toEqual({
      kind: 'pull',
      serverVersion: 3,
      cloudSavedAt: '2024-06-01T00:00:00Z',
      visibility: 'private',
      importPayload: PARSED_DATA,
    });
  });

  it('reports fresh when server version equals known version', () => {
    const call = makeCall({ knownVersion: 2 });
    const decision = decideFreshnessPull(makeState(), call, makeServerResponse({ version: 2 }));
    expect(decision).toEqual({ kind: 'fresh', serverVersion: 2 });
  });

  it('reports fresh when server version is less than known version', () => {
    const call = makeCall({ knownVersion: 5 });
    const decision = decideFreshnessPull(makeState(), call, makeServerResponse({ version: 3 }));
    expect(decision).toEqual({ kind: 'fresh', serverVersion: 3 });
  });

  it('reports dirty (phase 2) when an edit landed during the fetch', () => {
    // Pre-fetch was clean; post-fetch dataVersion now diverges from baseline.
    const state = makeState({ dataVersion: 6, baseline: cleanBaseline(5) });
    const decision = decideFreshnessPull(state, makeCall(), makeServerResponse({ version: 3 }));
    expect(decision).toEqual({ kind: 'dirty', serverVersion: 3 });
  });

  it('reports changed-during-pull (phase 2) when expectedDataVersion drifted during the fetch', () => {
    // dataVersion === baseline (not dirty) but no longer matches expectedDataVersion,
    // so the dirty gate passes and the changed-during-pull gate fires.
    const state = makeState({ dataVersion: 6, baseline: cleanBaseline(6) });
    const call = makeCall({ expectedDataVersion: 5, mode: 'pull-if-clean' });
    const decision = decideFreshnessPull(state, call, makeServerResponse({ version: 3 }));
    expect(decision).toEqual({ kind: 'changed-during-pull', serverVersion: 3 });
  });

  it('reports parse-failed when the server payload cannot be parsed', () => {
    (parseProjectData as Mock).mockReturnValue(null);
    const decision = decideFreshnessPull(makeState(), makeCall(), makeServerResponse({ version: 3 }));
    expect(decision).toEqual({ kind: 'parse-failed', serverVersion: 3 });
  });

  it('replace-with-server pulls despite a stale server version and dirty state', () => {
    const state = makeState({ dataVersion: 10, baseline: cleanBaseline(5) });
    const call = makeCall({ knownVersion: 5, mode: 'replace-with-server' });
    const decision = decideFreshnessPull(state, call, makeServerResponse({ version: 3 }));
    expect(decision).toMatchObject({ kind: 'pull', serverVersion: 3 });
  });

  it('pull-if-clean bypasses the version check but pulls only when clean', () => {
    const call = makeCall({ knownVersion: 5, mode: 'pull-if-clean', expectedDataVersion: 5 });
    const decision = decideFreshnessPull(makeState(), call, makeServerResponse({ version: 3 }));
    expect(decision).toMatchObject({ kind: 'pull', serverVersion: 3 });
  });
});

// ── Identity gate (BR-3) ─────────────────────────────────────────────

describe('decideFreshnessPull — identity gate (BR-3)', () => {
  describe('pre-fetch', () => {
    it('refuses when the live cloudId no longer matches the call', () => {
      const state = makeState({ liveCloudId: 'cloud-B' });
      expect(decideFreshnessPull(state, makeCall())).toEqual({ kind: 'switched-project' });
    });

    it('refuses when the live localId no longer matches the captured localId', () => {
      const state = makeState({ liveLocalId: 'local-B' });
      expect(decideFreshnessPull(state, makeCall())).toEqual({ kind: 'switched-project' });
    });

    it('refuses after a cloud-to-local switch (live cloudId null)', () => {
      const state = makeState({ liveCloudId: null, liveLocalId: 'local-B' });
      expect(decideFreshnessPull(state, makeCall())).toEqual({ kind: 'switched-project' });
    });

    it('identity beats allowDirtyOverwrite: replace-with-server refuses on mismatch even when dirty', () => {
      const state = makeState({ liveCloudId: 'cloud-B', liveLocalId: 'local-B', dataVersion: 10, baseline: cleanBaseline(5) });
      const call = makeCall({ mode: 'replace-with-server' });
      expect(decideFreshnessPull(state, call)).toEqual({ kind: 'switched-project' });
    });

    it('pull-if-clean refuses on identity mismatch', () => {
      const state = makeState({ liveCloudId: 'cloud-B' });
      const call = makeCall({ mode: 'pull-if-clean', expectedDataVersion: 5 });
      expect(decideFreshnessPull(state, call)).toEqual({ kind: 'switched-project' });
    });

    it('null call.localId matches a null live localId (unsaved shared-project viewer)', () => {
      const state = makeState({ liveLocalId: null });
      expect(decideFreshnessPull(state, makeCall({ localId: null }))).toBeNull();
    });

    it('undefined call.localId also matches a null live localId', () => {
      const state = makeState({ liveLocalId: null });
      expect(decideFreshnessPull(state, makeCall({ localId: undefined }))).toBeNull();
    });
  });

  describe('post-fetch', () => {
    it('refuses on live cloudId mismatch but still carries the persist payload', () => {
      const state = makeState({ liveCloudId: 'cloud-B', liveLocalId: 'local-B' });
      const decision = decideFreshnessPull(state, makeCall(), makeServerResponse({ version: 3 }));
      expect(decision).toEqual({
        kind: 'switched-project',
        serverVersion: 3,
        cloudSavedAt: '2024-06-01T00:00:00Z',
        visibility: 'private',
        importPayload: PARSED_DATA,
      });
    });

    it('refuses on live localId mismatch post-fetch', () => {
      const state = makeState({ liveLocalId: 'local-B' });
      const decision = decideFreshnessPull(state, makeCall(), makeServerResponse({ version: 3 }));
      expect(decision).toMatchObject({ kind: 'switched-project', serverVersion: 3 });
    });

    it('identity beats allowDirtyOverwrite post-fetch: replace-with-server refuses on mismatch with a dirty baseline', () => {
      // Pre-fix this returned 'pull' — the conflict-banner Load hole (worst BR-3 variant).
      const state = makeState({ liveCloudId: 'cloud-B', liveLocalId: 'local-B', dataVersion: 10, baseline: cleanBaseline(5) });
      const call = makeCall({ knownVersion: 5, mode: 'replace-with-server' });
      const decision = decideFreshnessPull(state, call, makeServerResponse({ version: 3 }));
      expect(decision).toMatchObject({ kind: 'switched-project', serverVersion: 3 });
    });

    it('pull-if-clean refuses on identity mismatch post-fetch', () => {
      const state = makeState({ liveCloudId: 'cloud-B' });
      const call = makeCall({ mode: 'pull-if-clean', expectedDataVersion: 5 });
      const decision = decideFreshnessPull(state, call, makeServerResponse({ version: 3 }));
      expect(decision).toMatchObject({ kind: 'switched-project', serverVersion: 3 });
    });

    it('reports parse-failed when the payload of a switched-project pull cannot be parsed', () => {
      (parseProjectData as Mock).mockReturnValue(null);
      const state = makeState({ liveCloudId: 'cloud-B' });
      const decision = decideFreshnessPull(state, makeCall(), makeServerResponse({ version: 3 }));
      expect(decision).toEqual({ kind: 'parse-failed', serverVersion: 3 });
    });

    it('matching identity still pulls (A-to-A re-init)', () => {
      const decision = decideFreshnessPull(makeState(), makeCall(), makeServerResponse({ version: 3 }));
      expect(decision).toMatchObject({ kind: 'pull', serverVersion: 3 });
    });

    it('null call.localId + null live localId still pulls (unsaved shared-project viewer)', () => {
      const state = makeState({ liveLocalId: null });
      const decision = decideFreshnessPull(state, makeCall({ localId: null }), makeServerResponse({ version: 3 }));
      expect(decision).toMatchObject({ kind: 'pull', serverVersion: 3 });
    });
  });
});

// ── Probe decision (P6 /meta probe) ──────────────────────────────────

describe('probeIndicatesFresh', () => {
  it('reports fresh when the probe version equals the known version', () => {
    expect(probeIndicatesFresh(2, 2)).toBe(true);
  });

  it('reports fresh when the probe version is older than the known version', () => {
    expect(probeIndicatesFresh(1, 5)).toBe(true);
  });

  it('reports stale (full fetch needed) when the probe version is newer', () => {
    expect(probeIndicatesFresh(3, 1)).toBe(false);
  });
});
