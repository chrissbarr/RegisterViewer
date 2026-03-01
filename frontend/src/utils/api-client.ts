import type { Visibility } from '../types/project';

function getApiBase(): string {
  return (import.meta.env.VITE_API_URL ?? '').trim();
}

export function isCloudEnabled(): boolean {
  return getApiBase().length > 0;
}

export class ApiError extends Error {
  status: number;
  errorBody: { error: string };

  constructor(status: number, errorBody: { error: string }) {
    super(errorBody.error);
    this.name = 'ApiError';
    this.status = status;
    this.errorBody = errorBody;
  }
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
    });

    if (!res.ok) {
      let errorBody: { error: string };
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

/** Credentials for authenticated API calls (JWT-preferred, token-hash fallback). */
export interface AuthCredentials {
  tokenHash: string;
  jwt?: string;
  /** Raw owner token (hex). Sent in body for JWT-authed create so server can verify possession. */
  ownerToken?: string;
}

function resolveAuthHeader(auth: AuthCredentials): string {
  return auth.jwt ? `Bearer ${auth.jwt}` : `Bearer ${auth.tokenHash}`;
}

interface CreateProjectResponse {
  id: string;
  shareUrl: string;
  createdAt: string;
}

export async function createProject(
  data: unknown,
  auth: AuthCredentials,
  visibility?: Visibility,
): Promise<CreateProjectResponse> {
  const body: { data: unknown; visibility?: string; ownerToken?: string } = { data };
  if (visibility !== undefined) {
    body.visibility = visibility;
  }

  // When JWT-authenticated, send raw owner token in body so server can verify
  // possession and compute the hash (SEC-12: prevents hash-only impersonation).
  if (auth.jwt && auth.ownerToken) {
    body.ownerToken = auth.ownerToken;
  }

  return apiFetch<CreateProjectResponse>('/api/projects', {
    method: 'POST',
    headers: { Authorization: resolveAuthHeader(auth) },
    body: JSON.stringify(body),
  });
}

interface GetProjectResponse {
  id: string;
  data: unknown;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
}

export async function getProject(id: string, auth?: AuthCredentials): Promise<GetProjectResponse> {
  const headers: Record<string, string> = {};
  if (auth) {
    headers['Authorization'] = resolveAuthHeader(auth);
  }
  return apiFetch<GetProjectResponse>(`/api/projects/${encodeURIComponent(id)}`, {
    headers,
  });
}

interface UpdateProjectResponse {
  id: string;
  updatedAt: string;
}

export async function updateProject(
  id: string,
  data: unknown,
  auth: AuthCredentials,
  visibility?: Visibility,
): Promise<UpdateProjectResponse> {
  const body: { data: unknown; visibility?: string } = { data };
  if (visibility !== undefined) {
    body.visibility = visibility;
  }
  return apiFetch<UpdateProjectResponse>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { Authorization: resolveAuthHeader(auth) },
      body: JSON.stringify(body),
    },
  );
}

export async function patchProjectVisibility(
  id: string,
  visibility: Visibility,
  auth: AuthCredentials,
): Promise<UpdateProjectResponse> {
  return apiFetch<UpdateProjectResponse>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'PATCH',
      headers: { Authorization: resolveAuthHeader(auth) },
      body: JSON.stringify({ visibility }),
    },
  );
}

export async function deleteProject(
  id: string,
  auth: AuthCredentials,
): Promise<void> {
  await apiFetchVoid(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: resolveAuthHeader(auth) },
    },
  );
}

interface ProjectListItem {
  id: string;
  title: string | null;
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
}

interface ListProjectsResponse {
  projects: ProjectListItem[];
}

export async function listProjects(authToken: string): Promise<ListProjectsResponse> {
  return apiFetch<ListProjectsResponse>('/api/projects', {
    headers: { Authorization: `Bearer ${authToken}` },
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
  ownerToken?: string,
): Promise<VerifyLoginCodeResponse> {
  const body: { email: string; code: string; ownerToken?: string } = { email, code };
  if (ownerToken) {
    body.ownerToken = ownerToken;
  }
  return apiFetch<VerifyLoginCodeResponse>('/api/auth/verify-code', {
    method: 'POST',
    body: JSON.stringify(body),
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
    body: JSON.stringify({}),
  });
}
