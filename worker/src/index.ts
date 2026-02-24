import type { Env, StoredProject, CreateProjectResponse, GetProjectResponse, UpdateProjectResponse, ListProjectsResponse } from './types';
import { ERRORS, LIMITS } from './types';
import { getProject, putProject, deleteProject, listProjectsByOwner, isValidVisibility, touchLastAccessed } from './data-access';
import { validateProjectData } from './validation';
import { extractTokenHash, isOwner } from './auth';
import { generateId } from './id';

// ---- CORS ----

const DEFAULT_ORIGINS = [
  'https://register-viewer.app',
  'https://chrissbarr.github.io',
];

function getAllowedOrigins(env: Env): string[] {
  if (env.ALLOWED_ORIGINS) {
    return env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  }
  return DEFAULT_ORIGINS;
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') ?? '';
  const allowed = getAllowedOrigins(env);
  const isDev = env.ENVIRONMENT !== 'production';
  const matchedOrigin = allowed.includes(origin) || (isDev && isLocalhostOrigin(origin)) ? origin : '';

  return {
    'Access-Control-Allow-Origin': matchedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

function jsonResponse(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...SECURITY_HEADERS, ...extraHeaders },
  });
}

function errorResponse(message: string, status: number, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse({ error: message }, status, extraHeaders);
}

// ---- Route patterns ----

const ID_PATTERN = /^\/api\/projects\/([A-Za-z0-9]{12})$/;
const COLLECTION_PATTERN = /^\/api\/projects\/?$/;

// ---- Body reading ----

async function readBodyWithLimit(
  request: Request,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false }> {
  // Fast path: Content-Length header present and valid
  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    return { ok: false };
  }

  // Streaming read with size cap
  const body = request.body;
  if (!body) return { ok: true, text: '' };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  } finally {
    reader.releaseLock();
  }

  const decoder = new TextDecoder();
  let text = '';
  for (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true });
  }
  text += decoder.decode();
  return { ok: true, text };
}

// ---- Body parsing ----

async function readAndParseJson<T = Record<string, unknown>>(
  request: Request,
  cors: Record<string, string>,
): Promise<{ ok: true; body: T } | { ok: false; response: Response }> {
  const result = await readBodyWithLimit(request, LIMITS.MAX_PAYLOAD_SIZE);
  if (!result.ok) {
    return { ok: false, response: errorResponse(`Request body must be at most ${LIMITS.MAX_PAYLOAD_SIZE} bytes`, 400, cors) };
  }

  try {
    return { ok: true, body: JSON.parse(result.text) as T };
  } catch {
    return { ok: false, response: errorResponse('Invalid JSON body', 400, cors) };
  }
}

// ---- Handlers ----

async function handleCreate(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const parsed = await readAndParseJson<{ data?: unknown; visibility?: unknown }>(request, cors);
  if (!parsed.ok) return parsed.response;

  const validation = validateProjectData(parsed.body.data);
  if (!validation.valid) {
    return errorResponse(validation.error, 400, cors);
  }

  // Validate visibility (optional, defaults to 'private')
  let visibility: 'private' | 'unlisted' = 'private';
  if (parsed.body.visibility !== undefined) {
    if (!isValidVisibility(parsed.body.visibility)) {
      return errorResponse(ERRORS.INVALID_VISIBILITY, 400, cors);
    }
    visibility = parsed.body.visibility;
  }

  // Generate ID with collision check (max 3 attempts)
  let id: string | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateId();
    const existing = await getProject(env.PROJECTS, candidate);
    if (!existing) {
      id = candidate;
      break;
    }
  }

  if (!id) {
    return errorResponse('Unable to generate a unique project ID. Please try again.', 503, cors);
  }

  const now = new Date().toISOString();
  const project: StoredProject = {
    schemaVersion: 1,
    id,
    ownerTokenHash: tokenHash,
    visibility,
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    data: parsed.body.data as StoredProject['data'],
  };

  await putProject(env.PROJECTS, project);

  const shareUrl = `${env.APP_URL}/#/p/${id}`;
  const response: CreateProjectResponse = {
    id,
    shareUrl,
    createdAt: now,
  };

  return jsonResponse(response, 201, cors);
}

async function handleGet(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
  cors: Record<string, string>,
): Promise<Response> {
  const project = await getProject(env.PROJECTS, id);
  if (!project) {
    return errorResponse('Project not found', 404, cors);
  }

  // Private projects require ownership
  if (project.visibility === 'private') {
    const tokenHash = extractTokenHash(request);
    if (!tokenHash || !isOwner(tokenHash, project)) {
      return errorResponse('Project not found', 404, cors);
    }
  }

  // Throttled write-back: update lastAccessedAt if >24h stale
  const lastAccessed = new Date(project.lastAccessedAt).getTime();
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  if (now - lastAccessed > ONE_DAY_MS) {
    ctx.waitUntil(touchLastAccessed(env.PROJECTS, id, new Date(now).toISOString()));
  }

  const response: GetProjectResponse = {
    id: project.id,
    data: project.data,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };

  const cacheControl = project.visibility === 'private'
    ? 'private, no-store'
    : 'private, max-age=60';

  return jsonResponse(response, 200, {
    ...cors,
    'Cache-Control': cacheControl,
  });
}

async function handleUpdate(request: Request, env: Env, id: string, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const existing = await getProject(env.PROJECTS, id);
  if (!existing || !isOwner(tokenHash, existing)) {
    return errorResponse('Project not found', 404, cors);
  }

  const parsed = await readAndParseJson<{ data?: unknown; visibility?: unknown }>(request, cors);
  if (!parsed.ok) return parsed.response;

  const validation = validateProjectData(parsed.body.data);
  if (!validation.valid) {
    return errorResponse(validation.error, 400, cors);
  }

  // Validate visibility (optional, keeps existing if not provided)
  let visibility = existing.visibility;
  if (parsed.body.visibility !== undefined) {
    if (!isValidVisibility(parsed.body.visibility)) {
      return errorResponse(ERRORS.INVALID_VISIBILITY, 400, cors);
    }
    visibility = parsed.body.visibility;
  }

  const now = new Date().toISOString();
  const updated: StoredProject = {
    ...existing,
    data: parsed.body.data as StoredProject['data'],
    visibility,
    updatedAt: now,
    lastAccessedAt: now,
  };

  await putProject(env.PROJECTS, updated);

  const response: UpdateProjectResponse = {
    id: updated.id,
    updatedAt: now,
  };

  return jsonResponse(response, 200, cors);
}

async function handlePatch(request: Request, env: Env, id: string, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const existing = await getProject(env.PROJECTS, id);
  if (!existing || !isOwner(tokenHash, existing)) {
    return errorResponse('Project not found', 404, cors);
  }

  const parsed = await readAndParseJson<{ visibility?: unknown }>(request, cors);
  if (!parsed.ok) return parsed.response;

  if (parsed.body.visibility === undefined) {
    return errorResponse('PATCH requires a visibility field', 400, cors);
  }
  if (!isValidVisibility(parsed.body.visibility)) {
    return errorResponse(ERRORS.INVALID_VISIBILITY, 400, cors);
  }

  const now = new Date().toISOString();
  const updated: StoredProject = {
    ...existing,
    visibility: parsed.body.visibility,
    updatedAt: now,
  };

  await putProject(env.PROJECTS, updated);

  const response: UpdateProjectResponse = {
    id: updated.id,
    updatedAt: now,
  };

  return jsonResponse(response, 200, cors);
}

async function handleDelete(request: Request, env: Env, id: string, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const existing = await getProject(env.PROJECTS, id);
  if (!existing || !isOwner(tokenHash, existing)) {
    return errorResponse('Project not found', 404, cors);
  }

  await deleteProject(env.PROJECTS, id, existing.ownerTokenHash);

  return new Response(null, { status: 204, headers: cors });
}

async function handleList(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const projects = await listProjectsByOwner(env.PROJECTS, tokenHash);

  const response: ListProjectsResponse = {
    projects: projects.map((p) => ({
      id: p.id,
      visibility: p.visibility,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  };

  return jsonResponse(response, 200, {
    ...cors,
    'Cache-Control': 'private, no-store',
  });
}

// ---- Worker entry point ----

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);
    const pathname = url.pathname;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      // Collection routes: POST /api/projects (create) and GET /api/projects (list)
      if (COLLECTION_PATTERN.test(pathname)) {
        if (method === 'POST') {
          return await handleCreate(request, env, cors);
        }
        if (method === 'GET') {
          return await handleList(request, env, cors);
        }
      }

      // Routes with :id parameter
      const idMatch = pathname.match(ID_PATTERN);
      if (idMatch) {
        const id = idMatch[1];

        if (method === 'GET') {
          return await handleGet(request, env, ctx, id, cors);
        }
        if (method === 'PUT') {
          return await handleUpdate(request, env, id, cors);
        }
        if (method === 'PATCH') {
          return await handlePatch(request, env, id, cors);
        }
        if (method === 'DELETE') {
          return await handleDelete(request, env, id, cors);
        }
      }

      return errorResponse('Not found', 404, cors);
    } catch (err) {
      console.error('Unhandled error:', err);
      return errorResponse('Internal server error', 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;
