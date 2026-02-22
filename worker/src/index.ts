import type { Env, StoredProject, CreateProjectResponse, GetProjectResponse, UpdateProjectResponse } from './types';
import { LIMITS } from './types';
import { getProject, putProject, deleteProject, touchLastAccessed } from './data-access';
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
  const matchedOrigin = allowed.includes(origin) || isLocalhostOrigin(origin) ? origin : '';

  return {
    'Access-Control-Allow-Origin': matchedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
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

// ---- Handlers ----

async function handleCreate(request: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > LIMITS.MAX_PAYLOAD_SIZE) {
    return errorResponse(`Request body must be at most ${LIMITS.MAX_PAYLOAD_SIZE} bytes`, 400, cors);
  }

  let body: { data?: unknown };
  try {
    const text = await request.text();
    if (text.length > LIMITS.MAX_PAYLOAD_SIZE) {
      return errorResponse(`Request body must be at most ${LIMITS.MAX_PAYLOAD_SIZE} bytes`, 400, cors);
    }
    body = JSON.parse(text);
  } catch {
    return errorResponse('Invalid JSON body', 400, cors);
  }

  const validation = validateProjectData(body.data);
  if (!validation.valid) {
    return errorResponse(validation.error, 400, cors);
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
    createdAt: now,
    updatedAt: now,
    lastAccessedAt: now,
    data: body.data as StoredProject['data'],
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
  _request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
  cors: Record<string, string>,
): Promise<Response> {
  const project = await getProject(env.PROJECTS, id);
  if (!project) {
    return errorResponse('Project not found', 404, cors);
  }

  // Throttled write-back: update lastAccessedAt if >24h stale
  const lastAccessed = new Date(project.lastAccessedAt).getTime();
  const now = Date.now();
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  if (now - lastAccessed > ONE_DAY_MS) {
    ctx.waitUntil(
      touchLastAccessed(env.PROJECTS, id, new Date(now).toISOString()),
    );
  }

  const response: GetProjectResponse = {
    id: project.id,
    data: project.data,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };

  return jsonResponse(response, 200, {
    ...cors,
    'Cache-Control': 'public, max-age=60',
  });
}

async function handleUpdate(request: Request, env: Env, id: string, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const existing = await getProject(env.PROJECTS, id);
  if (!existing) {
    return errorResponse('Project not found', 404, cors);
  }

  if (!isOwner(tokenHash, existing)) {
    return errorResponse('Forbidden: you do not own this project', 403, cors);
  }

  const contentLength = request.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > LIMITS.MAX_PAYLOAD_SIZE) {
    return errorResponse(`Request body must be at most ${LIMITS.MAX_PAYLOAD_SIZE} bytes`, 400, cors);
  }

  let body: { data?: unknown };
  try {
    const text = await request.text();
    if (text.length > LIMITS.MAX_PAYLOAD_SIZE) {
      return errorResponse(`Request body must be at most ${LIMITS.MAX_PAYLOAD_SIZE} bytes`, 400, cors);
    }
    body = JSON.parse(text);
  } catch {
    return errorResponse('Invalid JSON body', 400, cors);
  }

  const validation = validateProjectData(body.data);
  if (!validation.valid) {
    return errorResponse(validation.error, 400, cors);
  }

  const now = new Date().toISOString();
  const updated: StoredProject = {
    ...existing,
    data: body.data as StoredProject['data'],
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

async function handleDelete(request: Request, env: Env, id: string, cors: Record<string, string>): Promise<Response> {
  const tokenHash = extractTokenHash(request);
  if (!tokenHash) {
    return errorResponse('Missing or invalid Authorization header', 401, cors);
  }

  const existing = await getProject(env.PROJECTS, id);
  if (!existing) {
    return errorResponse('Project not found', 404, cors);
  }

  if (!isOwner(tokenHash, existing)) {
    return errorResponse('Forbidden: you do not own this project', 403, cors);
  }

  await deleteProject(env.PROJECTS, id);

  return new Response(null, { status: 204, headers: cors });
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
      // POST /api/projects
      if (method === 'POST' && COLLECTION_PATTERN.test(pathname)) {
        return await handleCreate(request, env, cors);
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
