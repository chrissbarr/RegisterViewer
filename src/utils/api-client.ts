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

interface CreateProjectResponse {
  id: string;
  shareUrl: string;
  createdAt: string;
}

export async function createProject(
  data: string,
  tokenHash: string,
  visibility?: 'private' | 'unlisted',
): Promise<CreateProjectResponse> {
  const body: { data: unknown; visibility?: string } = { data: JSON.parse(data) };
  if (visibility) {
    body.visibility = visibility;
  }
  return apiFetch<CreateProjectResponse>('/api/projects', {
    method: 'POST',
    headers: { Authorization: `Bearer ${tokenHash}` },
    body: JSON.stringify(body),
  });
}

interface GetProjectResponse {
  id: string;
  data: unknown;
  createdAt: string;
  updatedAt: string;
}

export async function getProject(id: string, tokenHash?: string): Promise<GetProjectResponse> {
  const headers: Record<string, string> = {};
  if (tokenHash) {
    headers['Authorization'] = `Bearer ${tokenHash}`;
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
  data: string,
  tokenHash: string,
  visibility?: 'private' | 'unlisted',
): Promise<UpdateProjectResponse> {
  const body: { data: unknown; visibility?: string } = { data: JSON.parse(data) };
  if (visibility !== undefined) {
    body.visibility = visibility;
  }
  return apiFetch<UpdateProjectResponse>(
    `/api/projects/${encodeURIComponent(id)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${tokenHash}` },
      body: JSON.stringify(body),
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

interface ProjectListItem {
  id: string;
  visibility: 'private' | 'unlisted';
  createdAt: string;
  updatedAt: string;
}

interface ListProjectsResponse {
  projects: ProjectListItem[];
}

export async function listProjects(tokenHash: string): Promise<ListProjectsResponse> {
  return apiFetch<ListProjectsResponse>('/api/projects', {
    headers: { Authorization: `Bearer ${tokenHash}` },
  });
}
