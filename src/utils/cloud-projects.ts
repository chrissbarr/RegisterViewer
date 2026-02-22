export function buildProjectUrl(id: string): string {
  return `${window.location.href.split('#')[0]}#/p/${id}`;
}

export interface LocalProjectRecord {
  id: string;
  ownerToken: string;
  name: string;
  savedAt: string;
  shareUrl: string;
}

const PROJECTS_STORAGE_KEY = 'register-viewer-projects';

export function loadLocalProjects(): LocalProjectRecord[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveLocalProjects(projects: LocalProjectRecord[]): void {
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(projects));
  } catch {
    // Silently fail if localStorage is full or unavailable
  }
}

export function addLocalProject(record: LocalProjectRecord): void {
  const projects = loadLocalProjects();
  // Replace existing record with same id if present
  const filtered = projects.filter((p) => p.id !== record.id);
  filtered.push(record);
  saveLocalProjects(filtered);
}

export function removeLocalProject(id: string): void {
  const projects = loadLocalProjects();
  saveLocalProjects(projects.filter((p) => p.id !== id));
}

export function updateLocalProject(
  id: string,
  updates: Partial<LocalProjectRecord>,
): void {
  const projects = loadLocalProjects();
  const index = projects.findIndex((p) => p.id === id);
  if (index >= 0) {
    projects[index] = { ...projects[index], ...updates };
    saveLocalProjects(projects);
  }
}
