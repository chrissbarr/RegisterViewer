import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from './types';
import { LIMITS } from './types';

// ---- Mock KV ----

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
    getWithMetadata: (() =>
      Promise.resolve({ value: null, metadata: null, cacheStatus: null })) as unknown as KVNamespace['getWithMetadata'],
  };
}

// ---- Test helpers ----

const VALID_TOKEN_HASH = 'a'.repeat(64);

function createEnv(overrides: Partial<Env> = {}): Env {
  return {
    PROJECTS: createMockKV(),
    APP_URL: 'https://register-viewer.app',
    ENVIRONMENT: 'development',
    ...overrides,
  };
}

function createCtx(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

function makeRequest(
  method: string,
  path: string,
  options: {
    origin?: string;
    token?: string;
    body?: unknown;
    contentLength?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (options.origin) headers.set('Origin', options.origin);
  if (options.token) headers.set('Authorization', `Bearer ${options.token}`);
  if (options.contentLength) headers.set('Content-Length', options.contentLength);

  const init: RequestInit = { method, headers };
  if (options.body !== undefined) {
    const bodyStr = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    init.body = bodyStr;
  }

  return new Request(`https://api.example.com${path}`, init);
}

function validProjectBody(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      version: 1,
      registers: [{ name: 'REG0', width: 8, fields: [] }],
      registerValues: { reg0: '0x00' },
    },
    ...overrides,
  };
}

// Dynamically import the worker to get the fetch handler
async function getWorker() {
  const mod = await import('./index');
  return mod.default;
}

// ---- Tests ----

describe('Worker handler integration tests', () => {
  let worker: { fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> };
  let env: Env;
  let ctx: ExecutionContext;

  beforeEach(async () => {
    worker = await getWorker();
    env = createEnv();
    ctx = createCtx();
  });

  // Helper: create a project and return its id
  async function createProject(
    overrides: { token?: string; body?: unknown; origin?: string } = {},
  ): Promise<string> {
    const req = makeRequest('POST', '/api/projects', {
      origin: overrides.origin ?? 'http://localhost:5173',
      token: overrides.token ?? VALID_TOKEN_HASH,
      body: overrides.body ?? validProjectBody(),
    });
    const res = await worker.fetch(req, env, ctx);
    const json = (await res.json()) as { id: string };
    return json.id;
  }

  // ============================================================
  // CORS
  // ============================================================

  describe('CORS gating', () => {
    it('returns CORS headers for allowed production origin', async () => {
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'https://register-viewer.app',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://register-viewer.app');
    });

    it('returns empty CORS origin for disallowed origin in production', async () => {
      env = createEnv({ ENVIRONMENT: 'production' });
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'https://evil.com',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('');
    });

    it('allows localhost in development mode', async () => {
      env = createEnv({ ENVIRONMENT: 'development' });
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it('blocks localhost in production mode', async () => {
      env = createEnv({ ENVIRONMENT: 'production' });
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('');
    });

    it('handles OPTIONS preflight with 204', async () => {
      const req = makeRequest('OPTIONS', '/api/projects', {
        origin: 'https://register-viewer.app',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(res.headers.get('Access-Control-Max-Age')).toBe('86400');
    });

    it('respects ALLOWED_ORIGINS env override', async () => {
      env = createEnv({
        ENVIRONMENT: 'production',
        ALLOWED_ORIGINS: 'https://custom.app, https://other.app',
      });
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'https://custom.app',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://custom.app');
    });
  });

  // ============================================================
  // Security headers
  // ============================================================

  describe('security headers', () => {
    it('includes X-Content-Type-Options: nosniff on JSON responses', async () => {
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('includes Referrer-Policy: no-referrer on JSON responses', async () => {
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('includes security headers on error responses', async () => {
      const req = makeRequest('GET', '/api/unknown-route', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    });

    it('includes Content-Type: application/json on all JSON responses', async () => {
      const req = makeRequest('GET', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Content-Type')).toBe('application/json');
    });
  });

  // ============================================================
  // Private project 404 (no info leak)
  // ============================================================

  describe('private project 404 (no info leak)', () => {
    it('returns 404 for private project accessed without auth', async () => {
      const id = await createProject();
      const req = makeRequest('GET', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        // no token
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Project not found');
    });

    it('returns 404 for private project accessed by wrong owner', async () => {
      const id = await createProject({ token: VALID_TOKEN_HASH });
      const wrongToken = 'b'.repeat(64);
      const req = makeRequest('GET', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: wrongToken,
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });

    it('returns 200 for private project accessed by owner', async () => {
      const id = await createProject({ token: VALID_TOKEN_HASH });
      const req = makeRequest('GET', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(200);
    });

    it('returns 200 for unlisted project accessed without auth', async () => {
      const id = await createProject({
        body: validProjectBody({ visibility: 'unlisted' }),
      });
      const req = makeRequest('GET', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        // no token — unlisted should be accessible
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(200);
    });

    it('PUT returns 404 for non-owner (same as missing project)', async () => {
      const id = await createProject({ token: VALID_TOKEN_HASH });
      const wrongToken = 'b'.repeat(64);
      const req = makeRequest('PUT', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: wrongToken,
        body: validProjectBody(),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });

    it('DELETE returns 404 for non-owner (same as missing project)', async () => {
      const id = await createProject({ token: VALID_TOKEN_HASH });
      const wrongToken = 'b'.repeat(64);
      const req = makeRequest('DELETE', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: wrongToken,
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ============================================================
  // Size limits
  // ============================================================

  describe('size limits', () => {
    it('rejects POST with Content-Length exceeding limit', async () => {
      const req = makeRequest('POST', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: validProjectBody(),
        contentLength: String(LIMITS.MAX_PAYLOAD_SIZE + 1),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain(`${LIMITS.MAX_PAYLOAD_SIZE}`);
    });

    it('rejects PUT with Content-Length exceeding limit', async () => {
      const id = await createProject();
      const req = makeRequest('PUT', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: validProjectBody(),
        contentLength: String(LIMITS.MAX_PAYLOAD_SIZE + 1),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
    });

    it('rejects PATCH with Content-Length exceeding limit', async () => {
      const id = await createProject();
      const req = makeRequest('PATCH', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: { visibility: 'unlisted' },
        contentLength: String(LIMITS.MAX_PAYLOAD_SIZE + 1),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
    });

    it('accepts POST with body within size limit', async () => {
      const req = makeRequest('POST', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: validProjectBody(),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(201);
    });
  });

  // ============================================================
  // Route matching & method handling
  // ============================================================

  describe('routing', () => {
    it('returns 404 for unknown routes', async () => {
      const req = makeRequest('GET', '/api/unknown', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });

    it('returns 404 for invalid project ID format', async () => {
      const req = makeRequest('GET', '/api/projects/short', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });

    it('returns 404 for unsupported method on collection', async () => {
      const req = makeRequest('DELETE', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });

    it('returns 404 for POST on item route', async () => {
      const req = makeRequest('POST', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: validProjectBody(),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });
  });

  // ============================================================
  // Auth
  // ============================================================

  describe('authentication', () => {
    it('returns 401 for POST without auth', async () => {
      const req = makeRequest('POST', '/api/projects', {
        origin: 'http://localhost:5173',
        body: validProjectBody(),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(401);
    });

    it('returns 401 for PUT without auth', async () => {
      const req = makeRequest('PUT', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
        body: validProjectBody(),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(401);
    });

    it('returns 401 for DELETE without auth', async () => {
      const req = makeRequest('DELETE', '/api/projects/abcdef123456', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(401);
    });

    it('returns 401 for list without auth', async () => {
      const req = makeRequest('GET', '/api/projects', {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(401);
    });
  });

  // ============================================================
  // Full CRUD flow
  // ============================================================

  describe('CRUD flow', () => {
    it('creates, reads, updates, and deletes a project', async () => {
      // Create
      const createReq = makeRequest('POST', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: validProjectBody({ visibility: 'unlisted' }),
      });
      const createRes = await worker.fetch(createReq, env, ctx);
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string; shareUrl: string; createdAt: string };
      expect(created.id).toMatch(/^[A-Za-z0-9]{12}$/);
      expect(created.shareUrl).toContain(created.id);
      expect(created.createdAt).toBeTruthy();

      // Read
      const getReq = makeRequest('GET', `/api/projects/${created.id}`, {
        origin: 'http://localhost:5173',
      });
      const getRes = await worker.fetch(getReq, env, ctx);
      expect(getRes.status).toBe(200);
      const fetched = (await getRes.json()) as { id: string; data: unknown };
      expect(fetched.id).toBe(created.id);
      expect(fetched.data).toBeDefined();

      // Update
      const updateReq = makeRequest('PUT', `/api/projects/${created.id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: validProjectBody({ visibility: 'private' }),
      });
      const updateRes = await worker.fetch(updateReq, env, ctx);
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as { id: string; updatedAt: string };
      expect(updated.id).toBe(created.id);
      expect(updated.updatedAt).toBeTruthy();

      // Delete
      const deleteReq = makeRequest('DELETE', `/api/projects/${created.id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
      });
      const deleteRes = await worker.fetch(deleteReq, env, ctx);
      expect(deleteRes.status).toBe(204);

      // Verify deleted
      const getAfterDelete = makeRequest('GET', `/api/projects/${created.id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
      });
      const deletedRes = await worker.fetch(getAfterDelete, env, ctx);
      expect(deletedRes.status).toBe(404);
    });

    it('list returns created projects', async () => {
      await createProject();
      await createProject();

      const req = makeRequest('GET', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { projects: unknown[] };
      expect(body.projects).toHaveLength(2);
    });
  });

  // ============================================================
  // PATCH visibility
  // ============================================================

  describe('PATCH visibility', () => {
    it('updates visibility without changing data', async () => {
      const id = await createProject({
        body: validProjectBody({ visibility: 'private' }),
      });

      const patchReq = makeRequest('PATCH', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: { visibility: 'unlisted' },
      });
      const patchRes = await worker.fetch(patchReq, env, ctx);
      expect(patchRes.status).toBe(200);
      const patched = (await patchRes.json()) as { id: string; updatedAt: string };
      expect(patched.id).toBe(id);
      expect(patched.updatedAt).toBeTruthy();

      // Verify visibility changed by reading as unauthenticated (unlisted is public)
      const getReq = makeRequest('GET', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
      });
      const getRes = await worker.fetch(getReq, env, ctx);
      expect(getRes.status).toBe(200);
    });

    it('rejects PATCH without auth', async () => {
      const id = await createProject();
      const req = makeRequest('PATCH', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        body: { visibility: 'unlisted' },
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(401);
    });

    it('rejects PATCH with wrong token', async () => {
      const id = await createProject();
      const req = makeRequest('PATCH', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: 'b'.repeat(64),
        body: { visibility: 'unlisted' },
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(404);
    });

    it('rejects PATCH without visibility field', async () => {
      const id = await createProject();
      const req = makeRequest('PATCH', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: {},
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('visibility');
    });

    it('rejects PATCH with invalid visibility value', async () => {
      const id = await createProject();
      const req = makeRequest('PATCH', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: { visibility: 'public' },
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('visibility');
    });
  });

  // ============================================================
  // Cache-Control headers
  // ============================================================

  describe('Cache-Control headers', () => {
    it('private project returns private, no-store', async () => {
      const id = await createProject();
      const req = makeRequest('GET', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    });

    it('unlisted project returns private, max-age=60', async () => {
      const id = await createProject({
        body: validProjectBody({ visibility: 'unlisted' }),
      });
      const req = makeRequest('GET', `/api/projects/${id}`, {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Cache-Control')).toBe('private, max-age=60');
    });

    it('list endpoint returns private, no-store', async () => {
      const req = makeRequest('GET', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    });
  });

  // ============================================================
  // Validation at handler level
  // ============================================================

  describe('request validation', () => {
    it('rejects invalid JSON body', async () => {
      const req = makeRequest('POST', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: 'not json{{{',
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('Invalid JSON');
    });

    it('rejects invalid project data structure', async () => {
      const req = makeRequest('POST', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: { data: { version: 1, registers: 'not-array', registerValues: {} } },
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
    });

    it('rejects invalid visibility value', async () => {
      const req = makeRequest('POST', '/api/projects', {
        origin: 'http://localhost:5173',
        token: VALID_TOKEN_HASH,
        body: validProjectBody({ visibility: 'public' }),
      });
      const res = await worker.fetch(req, env, ctx);
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('visibility');
    });
  });

  // ============================================================
  // Error handling
  // ============================================================

  describe('error handling', () => {
    it('returns 500 on unhandled error with security headers', async () => {
      // Force an error by providing a broken KV
      const brokenKV = {
        get: () => { throw new Error('KV exploded'); },
        put: vi.fn(),
        delete: vi.fn(),
        list: vi.fn(),
        getWithMetadata: vi.fn(),
      } as unknown as KVNamespace;
      const brokenEnv = createEnv({ PROJECTS: brokenKV });

      const req = makeRequest('GET', `/api/projects/abcdef123456`, {
        origin: 'http://localhost:5173',
      });
      const res = await worker.fetch(req, brokenEnv, ctx);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Internal server error');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });
  });
});
