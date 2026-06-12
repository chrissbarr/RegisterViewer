import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  isCloudEnabled,
  ApiError,
  createProject,
  getProject,
  getProjectMeta,
  updateProject,
  patchProjectVisibility,
  deleteProject,
  listProjects,
  sendLoginCode,
  verifyLoginCode,
  getAuthMe,
  postAuthLogout,
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
      version: 7,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const data = { version: 1, registers: [] };
    const jwt = 'a'.repeat(64);

    const result = await createProject(data, jwt);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/api/projects', {
      method: 'POST',
      signal: expect.any(AbortSignal),
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${'a'.repeat(64)}`,
      },
      body: JSON.stringify({ data }),
    });
    expect(result).toEqual(responseData);
  });

  it('throws ApiError on non-ok response', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(400, { error: 'Invalid data' }));

    const data = { version: 1 };
    const jwt = 'a'.repeat(64);

    await expect(createProject(data, jwt)).rejects.toThrow(ApiError);
    await expect(createProject(data, jwt)).rejects.toThrow('Invalid data');

    try {
      await createProject(data, jwt);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(400);
    }
  });

  it('handles response without JSON error body', async () => {
    mockFetch.mockResolvedValue(mockNonJsonErrorResponse(500, 'Internal Server Error'));

    const data = { version: 1 };
    const jwt = 'a'.repeat(64);

    await expect(createProject(data, jwt)).rejects.toThrow(ApiError);

    try {
      await createProject(data, jwt);
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

    await createProject({}, 'a'.repeat(64));

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
      visibility: 'unlisted',
      isOwner: true,
      version: 4,
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
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {},
      },
    );
    expect(result).toEqual(responseData);
  });

  it('sends Authorization header when jwt provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'ABC123DEF456',
        data: '{}',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    });

    const jwt = 'a'.repeat(64);
    await getProject('ABC123DEF456', jwt);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456',
      {
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );
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

  it('bypasses the browser HTTP cache with cache: no-store', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'ABC123DEF456',
        data: '{}',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }),
    });

    await getProject('ABC123DEF456');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].cache).toBe('no-store');
  });

});

describe('getProjectMeta', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes GET request to the /meta endpoint and returns metadata', async () => {
    const responseData = {
      id: 'ABC123DEF456',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      visibility: 'unlisted',
      isOwner: true,
      authenticated: true,
      version: 4,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const result = await getProjectMeta('ABC123DEF456');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456/meta',
      {
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {},
      },
    );
    expect(result).toEqual(responseData);
  });

  it('sends Authorization header when jwt provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'ABC123DEF456',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        visibility: 'private',
        isOwner: true,
        version: 1,
      }),
    });

    const jwt = 'a'.repeat(64);
    await getProjectMeta('ABC123DEF456', jwt);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456/meta',
      {
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );
  });

  it('throws ApiError on 404 (old API without /meta, or missing project)', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(404, { error: 'Project not found' }));

    await expect(getProjectMeta('NONEXISTENT12')).rejects.toThrow(ApiError);

    try {
      await getProjectMeta('NONEXISTENT12');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(404);
    }
  });

  it('bypasses the browser HTTP cache with cache: no-store', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'ABC123DEF456',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        visibility: 'unlisted',
        isOwner: true,
        version: 1,
      }),
    });

    await getProjectMeta('ABC123DEF456');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].cache).toBe('no-store');
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
    const data = { version: 1, registers: [] };
    const jwt = 'a'.repeat(64);

    const result = await updateProject(id, data, jwt, 1);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456',
      {
        method: 'PUT',
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${'a'.repeat(64)}`,
        },
        body: JSON.stringify({ data, version: 1 }),
      },
    );
    expect(result).toEqual(responseData);
  });

  it('returns visibility from the GET response', async () => {
    const responseData = {
      id: 'ABC123DEF456',
      data: '{"version":1,"registers":[]}',
      createdAt: '2024-01-01T00:00:00Z',
      updatedAt: '2024-01-02T00:00:00Z',
      isOwner: true,
      visibility: 'unlisted',
      version: 4,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const result = await getProject('ABC123DEF456');

    expect(result.visibility).toBe('unlisted');
  });

  it('sends only data and version in the PUT body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'TEST',
        updatedAt: '2024-01-01T00:00:00Z',
        version: 8,
      }),
    });

    const data = { version: 1, registers: [] };
    await updateProject('TEST', data, 'a'.repeat(64), 7);

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(Object.keys(body).sort()).toEqual(['data', 'version']);
    expect(body).toEqual({ data, version: 7 });
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

    await updateProject('test/with/slashes', {}, 'a'.repeat(64), 1);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[0]).toContain('test%2Fwith%2Fslashes');
  });

  it('throws ApiError on 401 (unauthorized)', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(401, { error: 'Unauthorized' }));

    await expect(
      updateProject('ABC123DEF456', {}, 'wrong'.repeat(16), 1),
    ).rejects.toThrow(ApiError);

    try {
      await updateProject('ABC123DEF456', {}, 'wrong'.repeat(16), 1);
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
    }
  });

  it('throws ApiError on 404 (not found)', async () => {
    mockFetch.mockResolvedValueOnce(mockErrorResponse(404, { error: 'Project not found' }));

    await expect(
      updateProject('NONEXISTENT', {}, 'a'.repeat(64), 1),
    ).rejects.toThrow(ApiError);
  });

  it('uses JWT in Authorization header when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'TEST', updatedAt: '2024-01-01T00:00:00Z' }),
    });

    await updateProject('TEST', { version: 1 }, 'my-jwt', 1);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe('Bearer my-jwt');
  });

  // Pins the GLOBAL no-store guarantee in apiRequest (not just the GET
  // helpers): a refactor moving the option onto getProject alone fails here.
  it('bypasses the browser HTTP cache with cache: no-store', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'TEST', updatedAt: '2024-01-01T00:00:00Z', version: 2 }),
    });

    await updateProject('TEST', { version: 1 }, 'a'.repeat(64), 1);

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].cache).toBe('no-store');
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
    const jwt = 'a'.repeat(64);

    await deleteProject(id, jwt);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/ABC123DEF456',
      {
        method: 'DELETE',
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {
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

  it('uses JWT in Authorization header when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers({ 'content-length': '0' }),
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });

    await deleteProject('TEST', 'my-jwt');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe('Bearer my-jwt');
  });
});

describe('createProject with visibility', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('includes visibility in request body when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'TEST',
        shareUrl: 'https://example.com/#/p/TEST',
        createdAt: '2024-01-01T00:00:00Z',
      }),
    });

    const data = { version: 1, registers: [] };
    await createProject(data, 'a'.repeat(64), 'unlisted');

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.visibility).toBe('unlisted');
  });

  it('omits visibility from body when not provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({
        id: 'TEST',
        shareUrl: 'https://example.com/#/p/TEST',
        createdAt: '2024-01-01T00:00:00Z',
      }),
    });

    const data = { version: 1, registers: [] };
    await createProject(data, 'a'.repeat(64));

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.visibility).toBeUndefined();
  });
});

describe('patchProjectVisibility', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes PATCH request with visibility and auth header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'TEST', updatedAt: '2024-01-01T00:00:00Z' }),
    });

    await patchProjectVisibility('TEST', 'unlisted', 'a'.repeat(64));

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects/TEST',
      {
        method: 'PATCH',
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${'a'.repeat(64)}`,
        },
        body: JSON.stringify({ visibility: 'unlisted' }),
      },
    );
  });

  it('uses JWT in Authorization header when provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'TEST', updatedAt: '2024-01-01T00:00:00Z' }),
    });

    await patchProjectVisibility('TEST', 'unlisted', 'my-jwt');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers.Authorization).toBe('Bearer my-jwt');
  });
});

describe('listProjects', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes GET request to /api/projects with auth header', async () => {
    const responseData = {
      projects: [
        { id: 'PROJ1', visibility: 'private', createdAt: '2024-01-01T00:00:00Z', updatedAt: '2024-01-01T00:00:00Z' },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const jwt = 'a'.repeat(64);
    const result = await listProjects(jwt);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/projects',
      {
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${jwt}`,
        },
      },
    );
    expect(result).toEqual(responseData);
  });

  it('throws ApiError on 401', async () => {
    mockFetch.mockResolvedValue(mockErrorResponse(401, { error: 'Unauthorized' }));

    await expect(listProjects('bad'.repeat(16))).rejects.toThrow(ApiError);
  });
});

describe('request timeout', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes an AbortSignal to fetch', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'TEST', data: '{}', createdAt: '', updatedAt: '' }),
    });

    await getProject('TEST');

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
  });

  it('aborts the request after 15 seconds', async () => {
    // Make fetch hang until aborted
    mockFetch.mockImplementationOnce((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      });
    });

    const promise = getProject('TEST');

    // Advance past the 15s timeout
    vi.advanceTimersByTime(15_000);

    await expect(promise).rejects.toThrow(
      expect.objectContaining({ name: 'AbortError' }),
    );
  });

  it('clears the timeout after an error response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    mockFetch.mockResolvedValueOnce(mockErrorResponse(500, { error: 'Server error' }));

    await expect(getProject('TEST')).rejects.toThrow(ApiError);

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });

  it('clears the timeout after a successful response', async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ id: 'TEST', data: '{}', createdAt: '', updatedAt: '' }),
    });

    await getProject('TEST');

    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
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

// ---- TEST-12: Auth endpoint functions ----

describe('sendLoginCode', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes POST request with email in body', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => ({ ok: true }),
    });

    await sendLoginCode('user@example.com');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/send-code',
      {
        method: 'POST',
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com' }),
      },
    );
  });

  it('throws ApiError on 429 rate limit', async () => {
    mockFetch.mockResolvedValue(
      mockErrorResponse(429, { error: 'Too many requests' }),
    );

    await expect(sendLoginCode('user@example.com')).rejects.toThrow(ApiError);

    try {
      await sendLoginCode('user@example.com');
    } catch (error) {
      expect((error as ApiError).status).toBe(429);
    }
  });
});

describe('verifyLoginCode', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes POST request with email and code', async () => {
    const responseData = {
      token: 'jwt-token-123',
      user: { id: 1, email: 'user@example.com' },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const result = await verifyLoginCode('user@example.com', '123456');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/verify-code',
      {
        method: 'POST',
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'user@example.com', code: '123456' }),
      },
    );
    expect(result).toEqual(responseData);
  });

  it('throws ApiError on 401 invalid code', async () => {
    mockFetch.mockResolvedValueOnce(
      mockErrorResponse(401, { error: 'Invalid or expired code' }),
    );

    await expect(verifyLoginCode('user@example.com', '999999')).rejects.toThrow(ApiError);
  });
});

describe('getAuthMe', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes GET request with JWT Bearer header', async () => {
    const responseData = { user: { id: 1, email: 'user@example.com' } };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: async () => responseData,
    });

    const result = await getAuthMe('my-jwt-token');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/me',
      {
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: { Authorization: 'Bearer my-jwt-token' },
      },
    );
    expect(result).toEqual(responseData);
  });

  it('throws ApiError on 401 for invalid JWT', async () => {
    mockFetch.mockResolvedValueOnce(
      mockErrorResponse(401, { error: 'Unauthorized' }),
    );

    await expect(getAuthMe('bad-token')).rejects.toThrow(ApiError);
  });
});

describe('postAuthLogout', () => {
  beforeEach(() => {
    mockFetch.mockClear();
    import.meta.env.VITE_API_URL = 'https://api.example.com';
  });

  it('makes POST request with JWT Bearer header', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      headers: new Headers({ 'content-length': '0' }),
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); },
    });

    await postAuthLogout('my-jwt-token');

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/api/auth/logout',
      {
        method: 'POST',
        signal: expect.any(AbortSignal),
        cache: 'no-store',
        headers: { Authorization: 'Bearer my-jwt-token' },
      },
    );
  });

  it('throws ApiError on 401 for invalid JWT', async () => {
    mockFetch.mockResolvedValueOnce(
      mockErrorResponse(401, { error: 'Unauthorized' }),
    );

    await expect(postAuthLogout('bad-token')).rejects.toThrow(ApiError);
  });
});
