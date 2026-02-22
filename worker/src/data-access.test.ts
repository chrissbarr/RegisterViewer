import { describe, it, expect } from 'vitest';
import { projectKey, ownerIndexKey, migrateStoredProject, getProject, putProject, touchLastAccessed, deleteProject, listProjectsByOwner, isValidVisibility } from './data-access';
import type { StoredProject } from './types';

/** Minimal in-memory KVNamespace mock for testing async KV operations. */
function createMockKV(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: ((key: string, format?: string) => {
      const val = store.get(key) ?? null;
      if (val === null) return Promise.resolve(null);
      if (format === 'json') return Promise.resolve(JSON.parse(val));
      return Promise.resolve(val);
    }) as KVNamespace['get'],
    put: ((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }) as KVNamespace['put'],
    delete: ((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }) as KVNamespace['delete'],
    list: ((opts?: { prefix?: string; cursor?: string }) => {
      const prefix = opts?.prefix ?? '';
      const keys = Array.from(store.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name, expiration: undefined, metadata: undefined }));
      return Promise.resolve({ keys, list_complete: true, cursor: '', cacheStatus: null });
    }) as KVNamespace['list'],
    getWithMetadata: (() => Promise.resolve({ value: null, metadata: null, cacheStatus: null })) as unknown as KVNamespace['getWithMetadata'],
  };
}

describe('projectKey', () => {
  it('formats key with project: prefix', () => {
    expect(projectKey('ABC123DEF456')).toBe('project:ABC123DEF456');
  });

  it('handles various ID formats', () => {
    expect(projectKey('test')).toBe('project:test');
    expect(projectKey('123')).toBe('project:123');
    expect(projectKey('a1b2c3d4e5f6')).toBe('project:a1b2c3d4e5f6');
  });

  it('handles empty string ID', () => {
    expect(projectKey('')).toBe('project:');
  });

  it('does not modify ID', () => {
    const id = 'TEST_ID_WITH_SPECIAL-CHARS';
    expect(projectKey(id)).toBe(`project:${id}`);
  });
});

describe('ownerIndexKey', () => {
  it('formats key with owner: prefix', () => {
    const hash = 'a'.repeat(64);
    expect(ownerIndexKey(hash, 'proj123')).toBe(`owner:${hash}:proj123`);
  });
});

describe('isValidVisibility', () => {
  it('accepts "private"', () => {
    expect(isValidVisibility('private')).toBe(true);
  });

  it('accepts "unlisted"', () => {
    expect(isValidVisibility('unlisted')).toBe(true);
  });

  it('rejects invalid strings', () => {
    expect(isValidVisibility('public')).toBe(false);
    expect(isValidVisibility('')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidVisibility(123)).toBe(false);
    expect(isValidVisibility(null)).toBe(false);
    expect(isValidVisibility(undefined)).toBe(false);
  });
});

describe('migrateStoredProject', () => {
  const createValidV1Project = (): StoredProject => ({
    schemaVersion: 1,
    id: 'ABC123DEF456',
    ownerTokenHash: 'a'.repeat(64),
    visibility: 'unlisted',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    lastAccessedAt: '2024-01-03T00:00:00Z',
    data: {
      version: 1,
      registers: [
        {
          name: 'TEST_REG',
          width: 8,
          fields: [],
        },
      ],
      registerValues: {},
    },
  });

  describe('v1 schema (current)', () => {
    it('returns v1 project as-is', () => {
      const project = createValidV1Project();
      const migrated = migrateStoredProject(project);

      expect(migrated).toEqual(project);
    });

    it('preserves all fields including visibility', () => {
      const project = createValidV1Project();
      const migrated = migrateStoredProject(project);

      expect(migrated.schemaVersion).toBe(1);
      expect(migrated.id).toBe('ABC123DEF456');
      expect(migrated.ownerTokenHash).toBe('a'.repeat(64));
      expect(migrated.visibility).toBe('unlisted');
      expect(migrated.createdAt).toBe('2024-01-01T00:00:00Z');
      expect(migrated.updatedAt).toBe('2024-01-02T00:00:00Z');
      expect(migrated.lastAccessedAt).toBe('2024-01-03T00:00:00Z');
      expect(migrated.data).toEqual(project.data);
    });

    it('defaults visibility to private if missing', () => {
      const project = {
        schemaVersion: 1,
        id: 'TEST',
        ownerTokenHash: 'a'.repeat(64),
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-02T00:00:00Z',
        lastAccessedAt: '2024-01-03T00:00:00Z',
        data: { version: 1, registers: [], registerValues: {} },
      };

      const migrated = migrateStoredProject(project);
      expect(migrated.visibility).toBe('private');
    });

    it('fills missing timestamps with current time', () => {
      const project = {
        schemaVersion: 1,
        id: 'TEST',
        ownerTokenHash: 'a'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      const before = new Date().toISOString();
      const migrated = migrateStoredProject(project);
      const after = new Date().toISOString();

      expect(migrated.createdAt).toBeDefined();
      expect(migrated.updatedAt).toBeDefined();
      expect(migrated.lastAccessedAt).toBeDefined();

      // Timestamps should be between before and after
      expect(migrated.createdAt >= before && migrated.createdAt <= after).toBe(true);
    });
  });

  describe('v0 schema (legacy)', () => {
    it('migrates v0 project to v1 with default visibility', () => {
      const v0Project = {
        id: 'LEGACY',
        ownerTokenHash: 'b'.repeat(64),
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z',
        data: {
          version: 1,
          registers: [],
          registerValues: {},
        },
      };

      const migrated = migrateStoredProject(v0Project);

      expect(migrated.schemaVersion).toBe(1);
      expect(migrated.id).toBe('LEGACY');
      expect(migrated.ownerTokenHash).toBe('b'.repeat(64));
      expect(migrated.visibility).toBe('private');
      expect(migrated.createdAt).toBe('2023-01-01T00:00:00Z');
      expect(migrated.updatedAt).toBe('2023-01-02T00:00:00Z');
      expect(migrated.lastAccessedAt).toBeDefined();
      expect(migrated.data).toEqual(v0Project.data);
    });

    it('migrates v0 project with schemaVersion: 0', () => {
      const v0Project = {
        schemaVersion: 0,
        id: 'LEGACY',
        ownerTokenHash: 'b'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      const migrated = migrateStoredProject(v0Project);

      expect(migrated.schemaVersion).toBe(1);
      expect(migrated.visibility).toBe('private');
    });

    it('backfills lastAccessedAt if missing', () => {
      const v0Project = {
        id: 'LEGACY',
        ownerTokenHash: 'b'.repeat(64),
        createdAt: '2023-01-01T00:00:00Z',
        updatedAt: '2023-01-02T00:00:00Z',
        data: { version: 1, registers: [], registerValues: {} },
      };

      const before = new Date().toISOString();
      const migrated = migrateStoredProject(v0Project);
      const after = new Date().toISOString();

      expect(migrated.lastAccessedAt).toBeDefined();
      expect(
        migrated.lastAccessedAt >= before && migrated.lastAccessedAt <= after,
      ).toBe(true);
    });

    it('backfills createdAt if missing', () => {
      const v0Project = {
        id: 'LEGACY',
        ownerTokenHash: 'b'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      const before = new Date().toISOString();
      const migrated = migrateStoredProject(v0Project);
      const after = new Date().toISOString();

      expect(migrated.createdAt).toBeDefined();
      expect(migrated.createdAt >= before && migrated.createdAt <= after).toBe(true);
    });

    it('backfills updatedAt if missing', () => {
      const v0Project = {
        id: 'LEGACY',
        ownerTokenHash: 'b'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      const before = new Date().toISOString();
      const migrated = migrateStoredProject(v0Project);
      const after = new Date().toISOString();

      expect(migrated.updatedAt).toBeDefined();
      expect(migrated.updatedAt >= before && migrated.updatedAt <= after).toBe(true);
    });

    it('preserves existing timestamps when present', () => {
      const v0Project = {
        id: 'LEGACY',
        ownerTokenHash: 'b'.repeat(64),
        createdAt: '2020-01-01T00:00:00Z',
        updatedAt: '2021-01-01T00:00:00Z',
        data: { version: 1, registers: [], registerValues: {} },
      };

      const migrated = migrateStoredProject(v0Project);

      expect(migrated.createdAt).toBe('2020-01-01T00:00:00Z');
      expect(migrated.updatedAt).toBe('2021-01-01T00:00:00Z');
    });
  });

  describe('future schema versions', () => {
    it('attempts best-effort migration for unknown future versions', () => {
      const futureProject = {
        schemaVersion: 2,
        id: 'FUTURE',
        ownerTokenHash: 'c'.repeat(64),
        visibility: 'unlisted',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
        lastAccessedAt: '2025-01-03T00:00:00Z',
        data: { version: 1, registers: [], registerValues: {} },
        // hypothetical future field
        newField: 'value',
      };

      const migrated = migrateStoredProject(futureProject);

      // Should return v1 schema with available fields
      expect(migrated.schemaVersion).toBe(1);
      expect(migrated.id).toBe('FUTURE');
      expect(migrated.ownerTokenHash).toBe('c'.repeat(64));
      expect(migrated.visibility).toBe('unlisted');
      expect(migrated.createdAt).toBe('2025-01-01T00:00:00Z');
      expect(migrated.updatedAt).toBe('2025-01-02T00:00:00Z');
      expect(migrated.lastAccessedAt).toBe('2025-01-03T00:00:00Z');
    });

    it('backfills missing fields in future schema', () => {
      const futureProject = {
        schemaVersion: 99,
        id: 'FUTURE',
        ownerTokenHash: 'c'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      const migrated = migrateStoredProject(futureProject);

      expect(migrated.schemaVersion).toBe(1);
      expect(migrated.visibility).toBe('private');
      expect(migrated.createdAt).toBeDefined();
      expect(migrated.updatedAt).toBeDefined();
      expect(migrated.lastAccessedAt).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('throws if input is not an object', () => {
      expect(() => migrateStoredProject(null)).toThrow('not an object');
      expect(() => migrateStoredProject(undefined)).toThrow('not an object');
      expect(() => migrateStoredProject('string')).toThrow('not an object');
      expect(() => migrateStoredProject(123)).toThrow('not an object');
      expect(() => migrateStoredProject([])).toThrow('missing a valid id');
    });

    it('throws if id is missing', () => {
      const invalid = {
        ownerTokenHash: 'a'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      expect(() => migrateStoredProject(invalid)).toThrow('missing a valid id');
    });

    it('throws if id is empty string', () => {
      const invalid = {
        id: '',
        ownerTokenHash: 'a'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      expect(() => migrateStoredProject(invalid)).toThrow('missing a valid id');
    });

    it('throws if id is not a string', () => {
      const invalid = {
        id: 123,
        ownerTokenHash: 'a'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      expect(() => migrateStoredProject(invalid)).toThrow('missing a valid id');
    });

    it('throws if data is missing', () => {
      const invalid = {
        id: 'TEST',
        ownerTokenHash: 'a'.repeat(64),
      };

      expect(() => migrateStoredProject(invalid)).toThrow('missing data');
    });

    it('throws if data is not an object', () => {
      const invalid = {
        id: 'TEST',
        ownerTokenHash: 'a'.repeat(64),
        data: 'invalid',
      };

      expect(() => migrateStoredProject(invalid)).toThrow('missing data');
    });

    it('throws if ownerTokenHash is missing', () => {
      const invalid = {
        id: 'TEST',
        data: { version: 1, registers: [], registerValues: {} },
      };

      expect(() => migrateStoredProject(invalid)).toThrow('missing ownerTokenHash');
    });

    it('throws if ownerTokenHash is not a string', () => {
      const invalid = {
        id: 'TEST',
        ownerTokenHash: 123,
        data: { version: 1, registers: [], registerValues: {} },
      };

      expect(() => migrateStoredProject(invalid)).toThrow('missing ownerTokenHash');
    });
  });

  describe('data preservation', () => {
    it('preserves complex project data', () => {
      const complexData = {
        version: 1,
        registers: [
          {
            id: 'reg-1',
            name: 'CONTROL',
            width: 32,
            offset: 0x00,
            description: 'Control register',
            fields: [
              {
                name: 'ENABLE',
                type: 'flag',
                msb: 0,
                lsb: 0,
              },
              {
                name: 'MODE',
                type: 'enum',
                msb: 3,
                lsb: 1,
                enumEntries: [
                  { value: 0, name: 'MODE_A' },
                  { value: 1, name: 'MODE_B' },
                ],
              },
            ],
          },
        ],
        registerValues: {
          'reg-1': '0xDEADBEEF',
        },
        project: {
          title: 'Test Project',
          description: 'A complex test project',
        },
        addressUnitBits: 8,
      };

      const project = {
        id: 'COMPLEX',
        ownerTokenHash: 'd'.repeat(64),
        data: complexData,
      };

      const migrated = migrateStoredProject(project);

      expect(migrated.data).toEqual(complexData);
    });

    it('does not mutate original object', () => {
      const original = {
        id: 'TEST',
        ownerTokenHash: 'e'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      const originalCopy = JSON.parse(JSON.stringify(original));

      migrateStoredProject(original);

      // Original should not be modified
      expect(original).toEqual(originalCopy);
    });
  });

  describe('timestamp format', () => {
    it('accepts ISO 8601 timestamps', () => {
      const timestamps = [
        '2024-01-01T00:00:00Z',
        '2024-12-31T23:59:59.999Z',
        '2024-06-15T12:30:45.123Z',
      ];

      timestamps.forEach((timestamp) => {
        const project = {
          schemaVersion: 1,
          id: 'TEST',
          ownerTokenHash: 'f'.repeat(64),
          visibility: 'unlisted' as const,
          createdAt: timestamp,
          updatedAt: timestamp,
          lastAccessedAt: timestamp,
          data: { version: 1, registers: [], registerValues: {} },
        };

        const migrated = migrateStoredProject(project);

        expect(migrated.createdAt).toBe(timestamp);
        expect(migrated.updatedAt).toBe(timestamp);
        expect(migrated.lastAccessedAt).toBe(timestamp);
      });
    });

    it('generates valid ISO 8601 timestamps for missing fields', () => {
      const project = {
        id: 'TEST',
        ownerTokenHash: 'f'.repeat(64),
        data: { version: 1, registers: [], registerValues: {} },
      };

      const migrated = migrateStoredProject(project);

      // Should be valid ISO 8601 format
      const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

      expect(migrated.createdAt).toMatch(iso8601Regex);
      expect(migrated.updatedAt).toMatch(iso8601Regex);
      expect(migrated.lastAccessedAt).toMatch(iso8601Regex);
    });
  });
});

describe('touchLastAccessed', () => {
  const createStoredProject = (overrides?: Partial<StoredProject>): StoredProject => ({
    schemaVersion: 1,
    id: 'TEST123',
    ownerTokenHash: 'a'.repeat(64),
    visibility: 'private',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-02T00:00:00Z',
    lastAccessedAt: '2024-01-03T00:00:00Z',
    data: { version: 1, registers: [], registerValues: {} },
    ...overrides,
  });

  it('updates lastAccessedAt on an existing project', async () => {
    const kv = createMockKV();
    const project = createStoredProject();
    await putProject(kv, project);

    const newTimestamp = '2024-06-15T12:00:00Z';
    await touchLastAccessed(kv, 'TEST123', newTimestamp);

    const updated = await getProject(kv, 'TEST123');
    expect(updated).not.toBeNull();
    expect(updated!.lastAccessedAt).toBe(newTimestamp);
  });

  it('preserves all other fields', async () => {
    const kv = createMockKV();
    const project = createStoredProject();
    await putProject(kv, project);

    const newTimestamp = '2024-06-15T12:00:00Z';
    await touchLastAccessed(kv, 'TEST123', newTimestamp);

    const updated = await getProject(kv, 'TEST123');
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(project.id);
    expect(updated!.ownerTokenHash).toBe(project.ownerTokenHash);
    expect(updated!.visibility).toBe(project.visibility);
    expect(updated!.createdAt).toBe(project.createdAt);
    expect(updated!.updatedAt).toBe(project.updatedAt);
    expect(updated!.data).toEqual(project.data);
  });

  it('is a no-op for a non-existent project', async () => {
    const kv = createMockKV();

    // Should not throw
    await touchLastAccessed(kv, 'NONEXISTENT', '2024-06-15T12:00:00Z');

    const result = await getProject(kv, 'NONEXISTENT');
    expect(result).toBeNull();
  });

  it('does not corrupt user data containing "lastAccessedAt"', async () => {
    const kv = createMockKV();
    const project = createStoredProject({
      data: {
        version: 1,
        registers: [
          {
            name: 'lastAccessedAt',
            width: 8,
            fields: [],
          },
        ],
        registerValues: { 'lastAccessedAt': '0xFF' },
      },
    });
    await putProject(kv, project);

    const newTimestamp = '2024-06-15T12:00:00Z';
    await touchLastAccessed(kv, 'TEST123', newTimestamp);

    const updated = await getProject(kv, 'TEST123');
    expect(updated).not.toBeNull();
    expect(updated!.lastAccessedAt).toBe(newTimestamp);
    // User data should be preserved intact
    expect(updated!.data.registers[0]).toEqual({
      name: 'lastAccessedAt',
      width: 8,
      fields: [],
    });
    expect(updated!.data.registerValues['lastAccessedAt']).toBe('0xFF');
  });
});

describe('putProject / getProject round-trip', () => {
  it('stores and retrieves a project', async () => {
    const kv = createMockKV();
    const project: StoredProject = {
      schemaVersion: 1,
      id: 'ROUNDTRIP',
      ownerTokenHash: 'b'.repeat(64),
      visibility: 'unlisted',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      lastAccessedAt: '2024-01-03T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };

    await putProject(kv, project);
    const retrieved = await getProject(kv, 'ROUNDTRIP');

    expect(retrieved).toEqual(project);
  });

  it('writes owner index key on put', async () => {
    const kv = createMockKV();
    const tokenHash = 'b'.repeat(64);
    const project: StoredProject = {
      schemaVersion: 1,
      id: 'INDEXED',
      ownerTokenHash: tokenHash,
      visibility: 'private',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      lastAccessedAt: '2024-01-03T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };

    await putProject(kv, project);

    // Verify owner index key exists
    const indexValue = await kv.get(ownerIndexKey(tokenHash, 'INDEXED'));
    expect(indexValue).toBe('1');
  });

  it('returns null for non-existent project', async () => {
    const kv = createMockKV();
    const result = await getProject(kv, 'MISSING');
    expect(result).toBeNull();
  });
});

describe('deleteProject', () => {
  it('removes both project key and owner index', async () => {
    const kv = createMockKV();
    const tokenHash = 'a'.repeat(64);
    const project: StoredProject = {
      schemaVersion: 1,
      id: 'TODELETE',
      ownerTokenHash: tokenHash,
      visibility: 'private',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      lastAccessedAt: '2024-01-03T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };

    await putProject(kv, project);
    await deleteProject(kv, 'TODELETE', tokenHash);

    expect(await getProject(kv, 'TODELETE')).toBeNull();
    expect(await kv.get(ownerIndexKey(tokenHash, 'TODELETE'))).toBeNull();
  });

  it('is idempotent for non-existent project', async () => {
    const kv = createMockKV();
    // Should not throw
    await deleteProject(kv, 'NONEXISTENT', 'a'.repeat(64));
  });
});

describe('listProjectsByOwner', () => {
  it('returns all projects owned by token hash', async () => {
    const kv = createMockKV();
    const tokenHash = 'a'.repeat(64);

    const project1: StoredProject = {
      schemaVersion: 1,
      id: 'PROJ1',
      ownerTokenHash: tokenHash,
      visibility: 'private',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      lastAccessedAt: '2024-01-01T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };

    const project2: StoredProject = {
      schemaVersion: 1,
      id: 'PROJ2',
      ownerTokenHash: tokenHash,
      visibility: 'unlisted',
      createdAt: '2024-01-02T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      lastAccessedAt: '2024-01-02T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };

    await putProject(kv, project1);
    await putProject(kv, project2);

    const result = await listProjectsByOwner(kv, tokenHash);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.id).sort()).toEqual(['PROJ1', 'PROJ2']);
  });

  it('does not return projects from other owners', async () => {
    const kv = createMockKV();
    const tokenA = 'a'.repeat(64);
    const tokenB = 'b'.repeat(64);

    const projectA: StoredProject = {
      schemaVersion: 1,
      id: 'PROJA',
      ownerTokenHash: tokenA,
      visibility: 'private',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      lastAccessedAt: '2024-01-01T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };

    const projectB: StoredProject = {
      schemaVersion: 1,
      id: 'PROJB',
      ownerTokenHash: tokenB,
      visibility: 'private',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      lastAccessedAt: '2024-01-01T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };

    await putProject(kv, projectA);
    await putProject(kv, projectB);

    const resultA = await listProjectsByOwner(kv, tokenA);
    expect(resultA).toHaveLength(1);
    expect(resultA[0].id).toBe('PROJA');

    const resultB = await listProjectsByOwner(kv, tokenB);
    expect(resultB).toHaveLength(1);
    expect(resultB[0].id).toBe('PROJB');
  });

  it('returns empty array for owner with no projects', async () => {
    const kv = createMockKV();
    const result = await listProjectsByOwner(kv, 'c'.repeat(64));
    expect(result).toEqual([]);
  });

  it('filters out phantom index entries (orphaned indexes)', async () => {
    const kv = createMockKV();
    const tokenHash = 'a'.repeat(64);

    // Write an owner index entry without a corresponding project
    await kv.put(ownerIndexKey(tokenHash, 'PHANTOM'), '1');

    // Write a real project
    const project: StoredProject = {
      schemaVersion: 1,
      id: 'REAL',
      ownerTokenHash: tokenHash,
      visibility: 'private',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-01T00:00:00Z',
      lastAccessedAt: '2024-01-01T00:00:00Z',
      data: { version: 1, registers: [], registerValues: {} },
    };
    await putProject(kv, project);

    const result = await listProjectsByOwner(kv, tokenHash);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('REAL');
  });
});
