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

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${getApiBase()}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
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

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return res.json();
}

export interface CreateProjectResponse {
  id: string;
  shareUrl: string;
  createdAt: string;
}

export async function createProject(
  data: string,
  tokenHash: string,
): Promise<CreateProjectResponse> {
  return apiFetch<CreateProjectResponse>('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenHash}` },
    body: JSON.stringify({ data: JSON.parse(data) }),
  });
}

export interface GetProjectResponse {
  id: string;
  data: string;
  createdAt: string;
  updatedAt: string;
}

export async function getProject(id: string): Promise<GetProjectResponse> {
  return apiFetch<GetProjectResponse>(`/api/projects/${encodeURIComponent(id)}`);
}

export interface UpdateProjectResponse {
  id: string;
  updatedAt: string;
}

export async function updateProject(
  id: string,
  data: string,
  tokenHash: string,
): Promise<UpdateProjectResponse> {
  return apiFetch<UpdateProjectResponse>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenHash}` },
      body: JSON.stringify({ data: JSON.parse(data) }),
    },
  );
}

export async function deleteProject(
  id: string,
  tokenHash: string,
): Promise<void> {
  await apiFetch<unknown>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${tokenHash}` },
    },
  );
}
