import type { Visibility } from '../types/project';

function getApiBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim();
}

export function isCloudEnabled(): boolean {
  return getApiBase().length > 0;
}

export class ApiError extends Error {
  status: number;
  readonly errorBody: Record<string, unknown>;

  constructor(status: number, errorBody: Record<string, unknown>) {
    super(String(errorBody.error ?? 'Unknown error'));
    this.name = 'ApiError';
    this.status = status;
    this.errorBody = errorBody;
  }
}

/** Type guard for 409 conflict responses with version info. */
export function isConflictError(err: unknown): err is ApiError & { errorBody: { currentVersion: number } } {
  return err instanceof ApiError
    && err.status === 409
    && typeof (err.errorBody as Record<string, unknown>)?.currentVersion === 'number';
}

const API_TIMEOUT_MS = 15_000;

async function apiRequest(path: string, options?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { ...(options?.headers as Record<string, string>) };
    if (options?.body) {
      headers['Content-Type'] ??= 'application/json';
    }

    const res = await fetch(`${getApiBase()}${path}`, {
      ...options,
      signal: controller.signal,
      headers,
      // Placed after the spread so no caller can re-enable HTTP caching: a
      // cached GET body once fed stale `version`s into the sync layer (BR-5).
      cache: 'no-store',
    });

    if (!res.ok) {
      let errorBody: Record<string, unknown>;
      try {
        errorBody = await res.json();
      } catch {
        errorBody = { error: res.statusText || 'Unknown error' };
      }
      throw new ApiError(res.status, errorBody);
    }

    return res;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await apiRequest(path, options);
  return res.json();
}

async function apiFetchVoid(path: string, options?: RequestInit): Promise<void> {
  await apiRequest(path, options);
}

interface CreateProjectResponse {
  id: string;
  shareUrl: string;
  createdAt: string;
  version: number;
}

export async function createProject(
  data: unknown,
  jwt: string,
  visibility?: Visibility,
): Promise<CreateProjectResponse> {
  const body: { data: unknown; visibility?: string } = { data };
  if (visibility !== undefined) {
    body.visibility = visibility;
  }

  return apiFetch<CreateProjectResponse>('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(body),
  });
}

export interface GetProjectResponse {
  id: string;
  data: unknown;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  /** True when the server verified a valid JWT on this request. Absent on older API responses. */
  authenticated?: boolean;
  visibility: Visibility;
  version: number;
}

export async function getProject(id: string, jwt?: string): Promise<GetProjectResponse> {
  const headers: Record<string, string> = {};
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  }
  return apiFetch<GetProjectResponse>(`/api/projects/${encodeURIComponent(id)}`, {
    headers,
  });
}

/**
 * Lightweight metadata probe (P6): the full GET response minus the `data`
 * payload. Used where only the version (plus metadata) is needed — the
 * freshness check and the unknown-version GET-then-PUT save path — so the
 * potentially large data blob is never transferred. Throws ApiError 404 on
 * an old API without the /meta endpoint (callers fall back to getProject).
 */
export async function getProjectMeta(id: string, jwt?: string): Promise<Omit<GetProjectResponse, 'data'>> {
  const headers: Record<string, string> = {};
  if (jwt) {
    headers['Authorization'] = `Bearer ${jwt}`;
  }
  return apiFetch<Omit<GetProjectResponse, 'data'>>(`/api/projects/${encodeURIComponent(id)}/meta`, {
    headers,
  });
}

interface UpdateProjectResponse {
  id: string;
  updatedAt: string;
  version: number;
}

export async function updateProject(
  id: string,
  data: unknown,
  jwt: string,
  version: number,
): Promise<UpdateProjectResponse> {
  return apiFetch<UpdateProjectResponse>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ data, version }),
    },
  );
}

interface PatchVisibilityResponse {
  id: string;
  updatedAt: string;
}

export async function patchProjectVisibility(
  id: string,
  visibility: Visibility,
  jwt: string,
): Promise<PatchVisibilityResponse> {
  return apiFetch<PatchVisibilityResponse>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ visibility }),
    },
  );
}

export async function deleteProject(
  id: string,
  jwt: string,
): Promise<void> {
  await apiFetchVoid(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${jwt}` },
    },
  );
}

interface ProjectListItem {
  id: string;
  title: string | null;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
  version: number;
}

interface ListProjectsResponse {
  projects: ProjectListItem[];
}

export async function listProjects(jwt: string): Promise<ListProjectsResponse> {
  return apiFetch<ListProjectsResponse>('/api/projects', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

// ---- Auth endpoints ----

export async function sendLoginCode(email: string): Promise<void> {
  await apiFetchVoid('/api/auth/send-code', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

interface VerifyLoginCodeResponse {
  token: string;
  user: { id: number; email: string };
}

export async function verifyLoginCode(
  email: string,
  code: string,
): Promise<VerifyLoginCodeResponse> {
  return apiFetch<VerifyLoginCodeResponse>('/api/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify({ email, code }),
  });
}

interface AuthMeResponse {
  user: { id: number; email: string };
  refreshedToken?: string;
}

export async function getAuthMe(jwt: string): Promise<AuthMeResponse> {
  return apiFetch<AuthMeResponse>('/api/auth/me', {
    headers: { Authorization: `Bearer ${jwt}` },
  });
}

export async function postAuthLogout(jwt: string): Promise<void> {
  await apiFetchVoid('/api/auth/logout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  });
}
