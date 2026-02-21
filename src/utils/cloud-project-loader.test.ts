import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchAndParseCloudProject } from './cloud-project-loader';
import * as apiClient from './api-client';
import * as storage from './storage';

vi.mock('./api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof apiClient>();
  return { ...actual, getProject: vi.fn() };
});
vi.mock('./storage', async (importOriginal) => {
  const actual = await importOriginal<typeof storage>();
  return { ...actual, importFromJson: vi.fn(actual.importFromJson) };
});

const mockGetProject = vi.mocked(apiClient.getProject);
const mockImportFromJson = vi.mocked(storage.importFromJson);

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
  };
}

describe('fetchAndParseCloudProject', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes object data to a JSON string before parsing', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromJson.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(mockGetProject).toHaveBeenCalledWith('ABC123DEF456');
    expect(result.registers).toHaveLength(1);
    expect(result.registers[0].name).toBe('STATUS');
  });

  it('passes string data through without double-stringifying', async () => {
    const jsonString = JSON.stringify(makeApiProjectData());
    const apiResponse = makeGetProjectResponse(jsonString);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromJson.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.registers).toHaveLength(1);
    expect(result.registers[0].name).toBe('STATUS');
  });

  it('threads updatedAt from the API response', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromJson.mockRestore();

    const result = await fetchAndParseCloudProject('ABC123DEF456');

    expect(result.updatedAt).toBe('2024-06-15T12:00:00Z');
  });

  it('throws when importFromJson returns null', async () => {
    const apiResponse = makeGetProjectResponse();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockGetProject.mockResolvedValue(apiResponse as any);
    mockImportFromJson.mockReturnValue(null);

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
    mockImportFromJson.mockRestore();

    await expect(fetchAndParseCloudProject('ABC123DEF456')).rejects.toThrow(
      'Failed to parse project data from cloud.',
    );
  });

  it('propagates API errors from getProject', async () => {
    mockGetProject.mockRejectedValue(new apiClient.ApiError(404, { error: 'Project not found' }));

    await expect(fetchAndParseCloudProject('NONEXISTENT')).rejects.toThrow('Project not found');
  });
});
