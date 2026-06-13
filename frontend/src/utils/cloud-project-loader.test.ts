import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAndParseCloudProject, isConfirmedNonOwner, decideStorageForFetched } from './cloud-project-loader';
import * as apiClient from './api-client';
import * as storage from './storage';

vi.mock('./api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>();
  return { ...actual, getProject: vi.fn() };
});
vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof storage>();
  return { ...actual, importFromObject: vi.fn(actual.importFromObject) };
});

const mockGetProject = vi.mocked(apiClient.getProject);
const mockImportFromObject = vi.mocked(storage.importFromObject);

// Minimal valid project data as it comes from the API (parsed JSON object)
function makeApiProjectData() {
  return {
    version: 1,
    registers: [{ name: 'STATUS', width: 32, fields: [] }],
    registerValues: { STATUS: '0xFF' },
  };
}

function makeGetProjectResponse(dataOverride?: unknown) {
  return {
    id: 'ABC123DEF456',
    data: dataOverride ?? makeApiProjectData(),
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-06-15T12:00:00Z',
    isOwner: false,
    visibility: 'private',
    version: 1,
  };
}

describe('fetchAndParseCloudProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes object data directly to importFromObject', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(mockGetProject).toHaveBeenCalledWith('ABC123DEF456', undefined);
    expect(result.registers).toHaveLength(1);
    expect(result.registers[0].name).toBe('STATUS');
  });

  it('passes string data through without double-stringifying', async () => {
    const jsonString = JSON.stringify(makeApiProjectData());
    const apiResponse = makeGetProjectResponse(jsonString);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.registers).toHaveLength(1);
    expect(result.registers[0].name).toBe('STATUS');
  });

  it('threads updatedAt from the API response', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.updatedAt).toBe('2024-06-15T12:00:00Z');
  });

  it('threads version from the API response', async () => {
    const apiResponse = { ...makeGetProjectResponse(), version: 3 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.version).toBe(3);
  });

  it('threads isOwner from the API response', async () => {
    const apiResponse = { ...makeGetProjectResponse(), isOwner: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.isOwner).toBe(true);
  });

  it('threads visibility from the API response', async () => {
    const apiResponse = { ...makeGetProjectResponse(), visibility: 'unlisted' as const };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.visibility).toBe('unlisted');
  });

  it('passes jwt parameter through to getProject', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    await fetchAndParseCloudProject('ABC123DEF456', 'test-jwt-token');

    expect(mockGetProject).toHaveBeenCalledWith('ABC123DEF456', 'test-jwt-token');
  });

  it('throws when importFromObject returns null', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockReturnValue(null);

    await expect(fetchAndParseCloudProject('ABC123DEF456')).rejects.toThrow(
      'Failed to parse project data from cloud.',
    );
  });

  it('throws when parsed result has zero registers', async () => {
    const apiResponse = makeGetProjectResponse({
      version: 1,
      registers: [],
      registerValues: {},
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    await expect(fetchAndParseCloudProject('ABC123DEF456')).rejects.toThrow(
      'Failed to parse project data from cloud.',
    );
  });

  it('propagates API errors from getProject', async () => {
    mockGetProject.mockRejectedValue(new apiClient.ApiError(404, { error: 'Project not found' }));

    await expect(fetchAndParseCloudProject('NONEXISTENT')).rejects.toThrow('Project not found');
  });

  it('threads authenticated from the API response', async () => {
    const apiResponse = { ...makeGetProjectResponse(), authenticated: true };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.authenticated).toBe(true);
  });

  it('leaves authenticated undefined when the API response omits it (old API)', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromObject.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.authenticated).toBeUndefined();
  });
});

describe('isConfirmedNonOwner', () => {
  it('is true only on positive evidence: authenticated:true with isOwner:false', () => {
    expect(isConfirmedNonOwner({ isOwner: false, authenticated: true })).toBe(true);
    expect(isConfirmedNonOwner({ isOwner: true, authenticated: true })).toBe(false);
    expect(isConfirmedNonOwner({ isOwner: false, authenticated: false })).toBe(false);
    expect(isConfirmedNonOwner({ isOwner: false, authenticated: undefined })).toBe(false);
    expect(isConfirmedNonOwner({ isOwner: false })).toBe(false);
  });
});

describe('decideStorageForFetched', () => {
  it('demotes to local only on confirmed non-ownership (authenticated:true, isOwner:false)', () => {
    expect(decideStorageForFetched({ isOwner: false, authenticated: true }, 'cloud')).toBe('local');
    expect(decideStorageForFetched({ isOwner: false, authenticated: true }, 'local')).toBe('local');
  });

  it('keeps the manifest storage class when ownership is confirmed (isOwner:true)', () => {
    expect(decideStorageForFetched({ isOwner: true, authenticated: true }, 'cloud')).toBe('cloud');
    expect(decideStorageForFetched({ isOwner: true, authenticated: true }, 'local')).toBe('local');
  });

  it('keeps the manifest storage class when ownership is unknown (authenticated missing/false)', () => {
    expect(decideStorageForFetched({ isOwner: false, authenticated: false }, 'cloud')).toBe('cloud');
    expect(decideStorageForFetched({ isOwner: false, authenticated: undefined }, 'cloud')).toBe('cloud');
    expect(decideStorageForFetched({ isOwner: false }, 'cloud')).toBe('cloud');
    expect(decideStorageForFetched({ isOwner: false }, 'local')).toBe('local');
  });
});
