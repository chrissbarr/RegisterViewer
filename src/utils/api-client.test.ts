import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isCloudEnabled,
  ApiError,
  createProject,
  getProject,
  updateProject,
  deleteProject,
} from './api-client';

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe('isCloudEnabled', () => {
  const originalEnv = import.meta.env.VITE_API_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete import.meta.env.VITE_API_URL;
    } else {
      import.meta.env.VITE_API_URL = originalEnv;
    }
  });

  it('returns true if VITE_API_URL is set', () => {
    import.meta.env.VITE_API_URL = 'https://api.example.com';
    expect(isCloudEnabled()).toBe(true);
  });

  it('returns false if VITE_API_URL is empty string', () => {
    import.meta.env.VITE_API_URL = '';
    expect(isCloudEnabled()).toBe(false);
  });

  it('returns false if VITE_API_URL is undefined', () => {
    delete import.meta.env.VITE_API_URL;
    expect(isCloudEnabled()).toBe(false);
  });
});

describe('ApiError', () => {
  it('creates an error with status and message', () => {
    const error = new ApiError(404, { error: 'Not found' });

    expect(error.name).toBe('ApiError');
    expect(error.status).toBe(404);
    expect(error.message).toBe('Not found');
    expect(error.errorBody).toEqual({ error: 'Not found' });
  });

  it('extends Error', () => {
    const error = new ApiError(500, { error: 'Server error' });

    expect(error instanceof Error).toBe(true);
    expect(error instanceof ApiError).toBe(true);
  });
});

function mockErrorResponse(status: number, body: { error: string }) {
  return {
    ok: false,
    status,
    json: async () => body,
  };
}

function mockNonJsonErrorResponse(status: number, statusText: string) {
  return {
    ok: false,
    status,
    statusText,
    json: async () => { throw new Error('Not JSON'); },
  };
}

describe('createProject', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes POST request with data and Authorization header', async () => {
    const responseData = {
      id: 'ABC123DEF456',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
      createdAt: '2024-01-01T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const data = '{"version":1,"registers":[]}';
    const tokenHash = 'a'.repeat(64);

    const result = await createProject(data, tokenHash);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${'a'.repeat(64)}`,
      },
      body: JSON.stringify({ data: JSON.parse(data) }),
    });
    expect(result).toEqual(responseData);
  });

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(400, { error: 'Invalid data' }));

    const data = '{"version":1}';
    const tokenHash = 'a'.repeat(64);

    await expect(createProject(data, tokenHash)).rejects.toThrow(ApiError);
    await expect(createProject(data, tokenHash)).rejects.toThrow('Invalid data');

    try {
      await createProject(data, tokenHash);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });

  it('handles response without JSON error body', async () => {
    mockFetch.mockResolvedValue(mockNonJsonErrorResponse(500, 'Internal Server Error'));

    const data = '{"version":1}';
    const tokenHash = 'a'.repeat(64);

    await expect(createProject(data, tokenHash)).rejects.toThrow(ApiError);

    try {
      await createProject(data, tokenHash);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(500);
      expect((error as ApiError).errorBody.error).toBe('Internal Server Error');
    }
  });

  it('includes Content-Type and Authorization headers', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'TEST',
        shareUrl: 'https://example.com',
        createdAt: '2024-01-01T00:00:00Z',
      }),
    });

    await createProject('{}', 'a'.repeat(64));

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers).toHaveProperty('Content-Type', 'application/json');
    expect(callArgs[1].headers).toHaveProperty('Authorization', `Bearer ${'a'.repeat(64)}`);
  });
});

describe('getProject', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes GET request and returns project data', async () => {
    const responseData = {
      id: 'ABC123DEF456',
      data: '{"version":1,"registers":[]}',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const result = await getProject('ABC123DEF456');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456',
      {
        headers: {
          'Content-Type': 'application/json',
        },
      },
    );
    expect(result).toEqual(responseData);
  });

  it('URL-encodes the project ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'test',
        data: '{}',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    });

    await getProject('test/with/slashes');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('test%2Fwith%2Fslashes');
  });

  it('throws ApiError on 404', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(404, { error: 'Project not found' }));

    await expect(getProject('NONEXISTENT')).rejects.toThrow(ApiError);
    await expect(getProject('NONEXISTENT')).rejects.toThrow('Project not found');

    try {
      await getProject('NONEXISTENT');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
    }
  });
});

describe('updateProject', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes PUT request with data and Authorization header', async () => {
    const responseData = {
      id: 'ABC123DEF456',
      updatedAt: '2024-01-02T00:00:00Z',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const id = 'ABC123DEF456';
    const data = '{"version":1,"registers":[]}';
    const tokenHash = 'a'.repeat(64);

    const result = await updateProject(id, data, tokenHash);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${'a'.repeat(64)}`,
        },
        body: JSON.stringify({ data: JSON.parse(data) }),
      },
    );
    expect(result).toEqual(responseData);
  });

  it('URL-encodes the project ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'test',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    });

    await updateProject('test/with/slashes', '{}', 'a'.repeat(64));

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('test%2Fwith%2Fslashes');
  });

  it('throws ApiError on 401 (unauthorized)', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(401, { error: 'Unauthorized' }));

    await expect(
      updateProject('ABC123DEF456', '{}', 'wrong'.repeat(16)),
    ).rejects.toThrow(ApiError);

    try {
      await updateProject('ABC123DEF456', '{}', 'wrong'.repeat(16));
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
    }
  });

  it('throws ApiError on 404 (not found)', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(404, { error: 'Project not found' }));

    await expect(
      updateProject('NONEXISTENT', '{}', 'a'.repeat(64)),
    ).rejects.toThrow(ApiError);
  });
});

describe('deleteProject', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes DELETE request with Authorization header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers({ 'content-length': '0' }),
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });

    const id = 'ABC123DEF456';
    const tokenHash = 'a'.repeat(64);

    await deleteProject(id, tokenHash);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456',
      {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${'a'.repeat(64)}`,
        },
      },
    );
  });

  it('URL-encodes the project ID', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers({ 'content-length': '0' }),
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });

    await deleteProject('test/with/slashes', 'a'.repeat(64));

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('test%2Fwith%2Fslashes');
  });

  it('returns void on success with 204 No Content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers({ 'content-length': '0' }),
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });

    const result = await deleteProject('ABC123DEF456', 'a'.repeat(64));

    expect(result).toBeUndefined();
  });

  it('throws ApiError on 401 (unauthorized)', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(401, { error: 'Unauthorized' }));

    await expect(deleteProject('ABC123DEF456', 'wrong'.repeat(16))).rejects.toThrow(
      ApiError,
    );

    try {
      await deleteProject('ABC123DEF456', 'wrong'.repeat(16));
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
    }
  });

  it('throws ApiError on 404 (not found)', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(404, { error: 'Project not found' }));

    await expect(deleteProject('NONEXISTENT', 'a'.repeat(64))).rejects.toThrow(ApiError);
  });
});

describe('API base URL', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  it('uses VITE_API_URL from environment', async () => {
    import.meta.env.VITE_API_URL = 'https://custom.api.com';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'TEST',
        data: '{}',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    });

    await getProject('TEST');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://custom.api.com/api/projects/TEST',
      expect.any(Object),
    );
  });

  it('uses empty string if VITE_API_URL is not set', async () => {
    import.meta.env.VITE_API_URL = '';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'TEST',
        data: '{}',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    });

    await getProject('TEST');

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/projects/TEST',
      expect.any(Object),
    );
  });
});
