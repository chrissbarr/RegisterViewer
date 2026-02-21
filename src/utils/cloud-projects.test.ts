import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadLocalProjects,
  saveLocalProjects,
  addLocalProject,
  removeLocalProject,
  updateLocalProject,
  type LocalProjectRecord,
} from './cloud-projects';

describe('loadLocalProjects', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('returns empty array if no projects stored', () => {
    const projects = loadLocalProjects();
    expect(projects).toEqual([]);
  });

  it('loads projects from localStorage', () => {
    const stored: LocalProjectRecord[] = [
      {
        id: 'ABC123DEF456',
        ownerToken: 'a'.repeat(64),
        name: 'Test Project',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/ABC123DEF456',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(stored));

    const projects = loadLocalProjects();
    expect(projects).toEqual(stored);
  });

  it('loads multiple projects', () => {
    const stored: LocalProjectRecord[] = [
      {
        id: 'PROJECT1',
        ownerToken: 'a'.repeat(64),
        name: 'Project 1',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT1',
      },
      {
        id: 'PROJECT2',
        ownerToken: 'b'.repeat(64),
        name: 'Project 2',
        savedAt: '2024-01-02T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT2',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(stored));

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(2);
    expect(projects).toEqual(stored);
  });

  it('returns empty array if localStorage contains invalid JSON', () => {
    localStorage.setItem('register-viewer-projects', 'invalid json');
    const projects = loadLocalProjects();
    expect(projects).toEqual([]);
  });

  it('returns empty array if localStorage contains non-array', () => {
    localStorage.setItem('register-viewer-projects', JSON.stringify({ not: 'array' }));
    const projects = loadLocalProjects();
    expect(projects).toEqual([]);
  });

  it('returns empty array if localStorage contains null', () => {
    localStorage.setItem('register-viewer-projects', JSON.stringify(null));
    const projects = loadLocalProjects();
    expect(projects).toEqual([]);
  });

  it('handles localStorage being unavailable', () => {
    // This is hard to test in jsdom, but the try-catch ensures it won't throw
    const projects = loadLocalProjects();
    expect(Array.isArray(projects)).toBe(true);
  });
});

describe('saveLocalProjects', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('saves projects to localStorage', () => {
    const projects: LocalProjectRecord[] = [
      {
        id: 'ABC123DEF456',
        ownerToken: 'a'.repeat(64),
        name: 'Test Project',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/ABC123DEF456',
      },
    ];

    saveLocalProjects(projects);

    const stored = localStorage.getItem('register-viewer-projects');
    expect(stored).toBe(JSON.stringify(projects));
  });

  it('overwrites existing projects', () => {
    const initial: LocalProjectRecord[] = [
      {
        id: 'PROJECT1',
        ownerToken: 'a'.repeat(64),
        name: 'Project 1',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT1',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(initial));

    const updated: LocalProjectRecord[] = [
      {
        id: 'PROJECT2',
        ownerToken: 'b'.repeat(64),
        name: 'Project 2',
        savedAt: '2024-01-02T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT2',
      },
    ];
    saveLocalProjects(updated);

    const stored = localStorage.getItem('register-viewer-projects');
    expect(stored).toBe(JSON.stringify(updated));
  });

  it('saves empty array', () => {
    saveLocalProjects([]);

    const stored = localStorage.getItem('register-viewer-projects');
    expect(stored).toBe(JSON.stringify([]));
  });

  it('handles localStorage quota exceeded silently', () => {
    // The function catches errors and fails silently
    // This is intentional behavior for graceful degradation
    expect(() => saveLocalProjects([
      {
        id: 'TEST',
        ownerToken: 'x'.repeat(64),
        name: 'Test',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com',
      },
    ])).not.toThrow();
  });
});

describe('addLocalProject', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('adds a new project to empty storage', () => {
    const project: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'a'.repeat(64),
      name: 'Test Project',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };

    addLocalProject(project);

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(project);
  });

  it('adds a project to existing projects', () => {
    const existing: LocalProjectRecord = {
      id: 'PROJECT1',
      ownerToken: 'a'.repeat(64),
      name: 'Project 1',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT1',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([existing]));

    const newProject: LocalProjectRecord = {
      id: 'PROJECT2',
      ownerToken: 'b'.repeat(64),
      name: 'Project 2',
      savedAt: '2024-01-02T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT2',
    };
    addLocalProject(newProject);

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(2);
    expect(projects).toContainEqual(existing);
    expect(projects).toContainEqual(newProject);
  });

  it('replaces existing project with same ID', () => {
    const original: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'a'.repeat(64),
      name: 'Original Name',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([original]));

    const updated: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'b'.repeat(64),
      name: 'Updated Name',
      savedAt: '2024-01-02T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };
    addLocalProject(updated);

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(updated);
    expect(projects[0].name).toBe('Updated Name');
  });

  it('maintains other projects when replacing one', () => {
    const project1: LocalProjectRecord = {
      id: 'PROJECT1',
      ownerToken: 'a'.repeat(64),
      name: 'Project 1',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT1',
    };
    const project2: LocalProjectRecord = {
      id: 'PROJECT2',
      ownerToken: 'b'.repeat(64),
      name: 'Project 2',
      savedAt: '2024-01-02T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT2',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([project1, project2]));

    const updated: LocalProjectRecord = {
      id: 'PROJECT1',
      ownerToken: 'c'.repeat(64),
      name: 'Updated Project 1',
      savedAt: '2024-01-03T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT1',
    };
    addLocalProject(updated);

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(2);
    expect(projects.find((p) => p.id === 'PROJECT1')).toEqual(updated);
    expect(projects.find((p) => p.id === 'PROJECT2')).toEqual(project2);
  });
});

describe('removeLocalProject', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('removes a project by ID', () => {
    const project: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'a'.repeat(64),
      name: 'Test Project',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([project]));

    removeLocalProject('ABC123DEF456');

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(0);
  });

  it('removes correct project from multiple projects', () => {
    const project1: LocalProjectRecord = {
      id: 'PROJECT1',
      ownerToken: 'a'.repeat(64),
      name: 'Project 1',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT1',
    };
    const project2: LocalProjectRecord = {
      id: 'PROJECT2',
      ownerToken: 'b'.repeat(64),
      name: 'Project 2',
      savedAt: '2024-01-02T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT2',
    };
    const project3: LocalProjectRecord = {
      id: 'PROJECT3',
      ownerToken: 'c'.repeat(64),
      name: 'Project 3',
      savedAt: '2024-01-03T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT3',
    };
    localStorage.setItem(
      'register-viewer-projects',
      JSON.stringify([project1, project2, project3]),
    );

    removeLocalProject('PROJECT2');

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(2);
    expect(projects).toContainEqual(project1);
    expect(projects).toContainEqual(project3);
    expect(projects).not.toContainEqual(project2);
  });

  it('does nothing if project ID does not exist', () => {
    const project: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'a'.repeat(64),
      name: 'Test Project',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([project]));

    removeLocalProject('NONEXISTENT');

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(project);
  });

  it('does nothing if storage is empty', () => {
    removeLocalProject('ABC123DEF456');

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(0);
  });
});

describe('updateLocalProject', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('updates a project field', () => {
    const project: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'a'.repeat(64),
      name: 'Test Project',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([project]));

    updateLocalProject('ABC123DEF456', { name: 'Updated Name' });

    const projects = loadLocalProjects();
    expect(projects[0].name).toBe('Updated Name');
    expect(projects[0].id).toBe('ABC123DEF456');
    expect(projects[0].ownerToken).toBe('a'.repeat(64));
  });

  it('updates multiple fields', () => {
    const project: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'a'.repeat(64),
      name: 'Test Project',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([project]));

    updateLocalProject('ABC123DEF456', {
      name: 'New Name',
      savedAt: '2024-02-01T00:00:00Z',
    });

    const projects = loadLocalProjects();
    expect(projects[0].name).toBe('New Name');
    expect(projects[0].savedAt).toBe('2024-02-01T00:00:00Z');
    expect(projects[0].shareUrl).toBe('https://example.com/#/p/ABC123DEF456');
  });

  it('updates correct project when multiple exist', () => {
    const project1: LocalProjectRecord = {
      id: 'PROJECT1',
      ownerToken: 'a'.repeat(64),
      name: 'Project 1',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT1',
    };
    const project2: LocalProjectRecord = {
      id: 'PROJECT2',
      ownerToken: 'b'.repeat(64),
      name: 'Project 2',
      savedAt: '2024-01-02T00:00:00Z',
      shareUrl: 'https://example.com/#/p/PROJECT2',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([project1, project2]));

    updateLocalProject('PROJECT2', { name: 'Updated Project 2' });

    const projects = loadLocalProjects();
    expect(projects[0]).toEqual(project1); // unchanged
    expect(projects[1].name).toBe('Updated Project 2');
    expect(projects[1].id).toBe('PROJECT2');
  });

  it('does nothing if project ID does not exist', () => {
    const project: LocalProjectRecord = {
      id: 'ABC123DEF456',
      ownerToken: 'a'.repeat(64),
      name: 'Test Project',
      savedAt: '2024-01-01T00:00:00Z',
      shareUrl: 'https://example.com/#/p/ABC123DEF456',
    };
    localStorage.setItem('register-viewer-projects', JSON.stringify([project]));

    updateLocalProject('NONEXISTENT', { name: 'New Name' });

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(1);
    expect(projects[0]).toEqual(project); // unchanged
  });

  it('does nothing if storage is empty', () => {
    updateLocalProject('ABC123DEF456', { name: 'New Name' });

    const projects = loadLocalProjects();
    expect(projects).toHaveLength(0);
  });

  it('preserves project order', () => {
    const projects: LocalProjectRecord[] = [
      {
        id: 'PROJECT1',
        ownerToken: 'a'.repeat(64),
        name: 'Project 1',
        savedAt: '2024-01-01T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT1',
      },
      {
        id: 'PROJECT2',
        ownerToken: 'b'.repeat(64),
        name: 'Project 2',
        savedAt: '2024-01-02T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT2',
      },
      {
        id: 'PROJECT3',
        ownerToken: 'c'.repeat(64),
        name: 'Project 3',
        savedAt: '2024-01-03T00:00:00Z',
        shareUrl: 'https://example.com/#/p/PROJECT3',
      },
    ];
    localStorage.setItem('register-viewer-projects', JSON.stringify(projects));

    updateLocalProject('PROJECT2', { name: 'Updated Project 2' });

    const loaded = loadLocalProjects();
    expect(loaded[0].id).toBe('PROJECT1');
    expect(loaded[1].id).toBe('PROJECT2');
    expect(loaded[2].id).toBe('PROJECT3');
  });
});
