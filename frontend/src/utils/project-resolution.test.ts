import { describe, it, expect } from 'vitest';
import { resolveInitialProject } from './project-resolution';
import type { ProjectManifest, ProjectManifestEntry } from '../types/project';

function makeManifestEntry(overrides?: Partial<ProjectManifestEntry>): ProjectManifestEntry {
  return {
    localId: 'local-1',
    cloudId: null,
    name: 'Test Project',
    visibility: 'private',
    createdAt: '2026-01-01T00:00:00.000Z',
    localSavedAt: '2026-01-01T00:00:00.000Z',
    cloudSavedAt: null,
    ...overrides,
  };
}

function makeManifest(projects: ProjectManifestEntry[] = []): ProjectManifest {
  return { version: 1, projects };
}

describe('resolveInitialProject', () => {
  describe('snapshot hash', () => {
    it('returns snapshot type for #data= hash', () => {
      const result = resolveInitialProject('#data=abc123', makeManifest(), null, false);
      expect(result).toEqual({ type: 'snapshot', data: 'abc123' });
    });

    it('returns the full data string after #data=', () => {
      const result = resolveInitialProject('#data=long-encoded-data-here', makeManifest(), null, true);
      expect(result).toEqual({ type: 'snapshot', data: 'long-encoded-data-here' });
    });

    it('takes priority over cloud hash and session', () => {
      const manifest = makeManifest([makeManifestEntry({ localId: 'session-id' })]);
      const result = resolveInitialProject('#data=xyz', manifest, 'session-id', true);
      expect(result.type).toBe('snapshot');
    });
  });

  describe('cloud hash', () => {
    it('returns cloud type for #/p/{12-char-id} when cloud enabled', () => {
      const result = resolveInitialProject('#/p/AbCdEf123456', makeManifest(), null, true);
      expect(result).toEqual({ type: 'cloud', cloudId: 'AbCdEf123456' });
    });

    it('falls through when cloud is disabled', () => {
      const result = resolveInitialProject('#/p/AbCdEf123456', makeManifest(), null, false);
      expect(result).toEqual({ type: 'create-default' });
    });

    it('falls through for invalid cloud id format (too short)', () => {
      const result = resolveInitialProject('#/p/abc', makeManifest(), null, true);
      expect(result).toEqual({ type: 'create-default' });
    });

    it('falls through for invalid cloud id format (too long)', () => {
      const result = resolveInitialProject('#/p/AbCdEf1234567', makeManifest(), null, true);
      expect(result).toEqual({ type: 'create-default' });
    });

    it('falls through for invalid cloud id format (special chars)', () => {
      const result = resolveInitialProject('#/p/AbCdEf12345!', makeManifest(), null, true);
      expect(result).toEqual({ type: 'create-default' });
    });
  });

  describe('session active id', () => {
    it('returns local type when session id exists in manifest', () => {
      const manifest = makeManifest([makeManifestEntry({ localId: 'session-project' })]);
      const result = resolveInitialProject('', manifest, 'session-project', false);
      expect(result).toEqual({ type: 'local', localId: 'session-project' });
    });

    it('falls through when session id is NOT in manifest', () => {
      const manifest = makeManifest([makeManifestEntry({ localId: 'other-id' })]);
      const result = resolveInitialProject('', manifest, 'deleted-project', false);
      // Should fall through to most recent project
      expect(result).toEqual({ type: 'local', localId: 'other-id' });
    });

    it('falls through when session id is null', () => {
      const manifest = makeManifest([makeManifestEntry({ localId: 'proj-1' })]);
      const result = resolveInitialProject('', manifest, null, false);
      expect(result).toEqual({ type: 'local', localId: 'proj-1' });
    });
  });

  describe('most recent project from manifest', () => {
    it('returns the most recently saved project', () => {
      const older = makeManifestEntry({ localId: 'older', localSavedAt: '2026-01-01T00:00:00.000Z' });
      const newer = makeManifestEntry({ localId: 'newer', localSavedAt: '2026-02-01T00:00:00.000Z' });
      const manifest = makeManifest([older, newer]);
      const result = resolveInitialProject('', manifest, null, false);
      expect(result).toEqual({ type: 'local', localId: 'newer' });
    });

    it('works with a single project', () => {
      const manifest = makeManifest([makeManifestEntry({ localId: 'only-one' })]);
      const result = resolveInitialProject('', manifest, null, false);
      expect(result).toEqual({ type: 'local', localId: 'only-one' });
    });
  });

  describe('create-default', () => {
    it('returns create-default when manifest is empty', () => {
      const result = resolveInitialProject('', makeManifest(), null, false);
      expect(result).toEqual({ type: 'create-default' });
    });

    it('returns create-default when cloud hash but cloud disabled and no projects', () => {
      const result = resolveInitialProject('#/p/AbCdEf123456', makeManifest(), null, false);
      expect(result).toEqual({ type: 'create-default' });
    });
  });

  describe('priority ordering', () => {
    it('snapshot > cloud > session > manifest > default', () => {
      const manifest = makeManifest([makeManifestEntry({ localId: 'proj-1' })]);

      // Snapshot wins over everything
      const r1 = resolveInitialProject('#data=abc', manifest, 'proj-1', true);
      expect(r1.type).toBe('snapshot');

      // Cloud wins over session and manifest
      const r2 = resolveInitialProject('#/p/AbCdEf123456', manifest, 'proj-1', true);
      expect(r2.type).toBe('cloud');

      // Session wins over manifest
      const r3 = resolveInitialProject('', manifest, 'proj-1', true);
      expect(r3.type).toBe('local');
      expect((r3 as { type: 'local'; localId: string }).localId).toBe('proj-1');

      // Manifest is used when no session
      const r4 = resolveInitialProject('', manifest, null, true);
      expect(r4.type).toBe('local');

      // Default when nothing
      const r5 = resolveInitialProject('', makeManifest(), null, true);
      expect(r5.type).toBe('create-default');
    });
  });
});
