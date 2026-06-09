import { describe, it, expect, vi } from 'vitest';
import { materializeCloudProject } from './cloud-materialize';
import type { MaterializeImportResult } from './cloud-materialize';
import { makeRegister, makeState } from '../test/helpers';
import type { SerializedAppState } from '../types/register';

// ── Helpers ──────────────────────────────────────────────────────────

const IMPORT_RESULT: MaterializeImportResult = {
  registers: [makeRegister({ id: 'r1', name: 'STATUS', width: 32 })],
  values: { r1: 0xFFn },
  project: { title: 'Test Project' },
  addressUnitBits: 8,
};

function makePersist() {
  return vi.fn((_serialized: SerializedAppState) => true);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('materializeCloudProject', () => {
  describe('replace mode', () => {
    it('serializes from the import result and drops UI fields', () => {
      const persist = makePersist();
      const loadExistingState = vi.fn();

      const result = materializeCloudProject({
        writeMode: 'replace',
        localId: 'local-1',
        cloudId: 'cloud-1',
        importResult: IMPORT_RESULT,
        callbacks: { persist, loadExistingState },
      });

      expect(result.persisted).toBe(true);
      // Existing UI state must NOT be consulted on replace.
      expect(loadExistingState).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalledTimes(1);
      const serialized = persist.mock.calls[0][0];
      // serializeImportResult shape: activeRegisterId defaults to first register,
      // map UI fields are omitted (fall back to storage defaults on read).
      expect(serialized).toEqual({
        registers: IMPORT_RESULT.registers,
        activeRegisterId: 'r1',
        registerValues: { r1: '0xff' },
        project: { title: 'Test Project' },
        addressUnitBits: 8,
      });
      expect(serialized).not.toHaveProperty('mapTableWidth');
      expect(serialized).not.toHaveProperty('mapShowGaps');
      expect(serialized).not.toHaveProperty('mapSortDescending');
    });
  });

  describe('create mode', () => {
    it('serializes from the import result and drops UI fields', () => {
      const persist = makePersist();

      const result = materializeCloudProject({
        writeMode: 'create',
        localId: null,
        cloudId: 'cloud-1',
        importResult: IMPORT_RESULT,
        callbacks: { persist, loadExistingState: vi.fn() },
      });

      expect(result.persisted).toBe(true);
      const serialized = persist.mock.calls[0][0];
      expect(serialized).toEqual({
        registers: IMPORT_RESULT.registers,
        activeRegisterId: 'r1',
        registerValues: { r1: '0xff' },
        project: { title: 'Test Project' },
        addressUnitBits: 8,
      });
    });
  });

  describe('merge mode', () => {
    it('preserves existing UI fields (activeRegisterId, mapTableWidth, mapShowGaps, mapSortDescending)', () => {
      const persist = makePersist();
      const loadExistingState = vi.fn(() => makeState({
        registers: [],
        activeRegisterId: 'REG_X',
        registerValues: {},
        mapTableWidth: 64,
        mapShowGaps: false,
        mapSortDescending: true,
        addressUnitBits: 8,
      }));

      const result = materializeCloudProject({
        writeMode: 'merge',
        localId: 'local-1',
        cloudId: 'cloud-1',
        importResult: IMPORT_RESULT,
        callbacks: { persist, loadExistingState },
      });

      expect(result.persisted).toBe(true);
      expect(loadExistingState).toHaveBeenCalledWith('local-1');
      const serialized = persist.mock.calls[0][0];
      expect(serialized).toMatchObject({
        registers: IMPORT_RESULT.registers,
        registerValues: { r1: '0xff' },
        project: { title: 'Test Project' },
        activeRegisterId: 'REG_X',
        mapTableWidth: 64,
        mapShowGaps: false,
        mapSortDescending: true,
        addressUnitBits: 8,
      });
    });

    it('falls back to defaults when no existing project state is found', () => {
      const persist = makePersist();
      const loadExistingState = vi.fn(() => null);

      materializeCloudProject({
        writeMode: 'merge',
        localId: 'local-1',
        cloudId: 'cloud-1',
        importResult: IMPORT_RESULT,
        callbacks: { persist, loadExistingState },
      });

      const serialized = persist.mock.calls[0][0];
      expect(serialized).toMatchObject({
        activeRegisterId: 'r1', // first register id from import result
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });
    });
  });

  describe('skip mode', () => {
    it('is non-writing — never invokes persist or loadExistingState', () => {
      const persist = makePersist();
      const loadExistingState = vi.fn();

      const result = materializeCloudProject({
        writeMode: 'skip',
        localId: 'local-1',
        cloudId: 'cloud-1',
        importResult: IMPORT_RESULT,
        callbacks: { persist, loadExistingState },
      });

      expect(result.persisted).toBe(false);
      expect(persist).not.toHaveBeenCalled();
      expect(loadExistingState).not.toHaveBeenCalled();
    });
  });

  it('propagates the persist callback result', () => {
    const result = materializeCloudProject({
      writeMode: 'replace',
      localId: 'local-1',
      cloudId: 'cloud-1',
      importResult: IMPORT_RESULT,
      callbacks: { persist: vi.fn((_s: SerializedAppState) => false), loadExistingState: vi.fn() },
    });
    expect(result.persisted).toBe(false);
  });
});
