import { render, screen } from '@testing-library/react';
import { MyProjectsDialog } from './my-projects-dialog';
import type { ProjectListEntry } from '../../types/project';

// jsdom doesn't implement HTMLDialogElement.showModal/close
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});

function makeProject(overrides: Partial<ProjectListEntry> = {}): ProjectListEntry {
  return {
    localId: 'test-id-1',
    cloudId: null,
    name: 'Test Project',
    visibility: 'private' as const,
    createdAt: '2025-01-01T00:00:00Z',
    localSavedAt: '2025-01-01T00:00:00Z',
    cloudSavedAt: null,
    isCloudSaved: false,
    ...overrides,
  };
}

const mockCreateNewProject = vi.fn(() => 'new-id');
const mockSwitchProject = vi.fn();
const mockDeleteLocalProject = vi.fn();
const mockRenameProject = vi.fn();
const mockRefreshProjectList = vi.fn();
const mockGetActiveProject = vi.fn(() => null);
const mockSetVisibility = vi.fn();
const mockAnnounce = vi.fn();

let mockProjects: ProjectListEntry[] = [];
let mockActiveLocalId: string | null = null;

vi.mock('../../context/project-storage-context', () => ({
  useProjectStorage: () => ({
    activeLocalId: mockActiveLocalId,
    projects: mockProjects,
  }),
  useProjectStorageActions: () => ({
    createNewProject: mockCreateNewProject,
    switchProject: mockSwitchProject,
    deleteLocalProject: mockDeleteLocalProject,
    renameProject: mockRenameProject,
    refreshProjectList: mockRefreshProjectList,
    getActiveProject: mockGetActiveProject,
  }),
}));

vi.mock('../../context/cloud-sync-context', () => ({
  useCloudSync: () => ({
    cloudId: null,
    isOwner: false,
    isDirty: false,
    status: 'idle' as const,
    error: null,
    shareUrl: null,
    lastCloudSavedAt: null,
    visibility: 'private' as const,
  }),
  useCloudSyncActions: () => ({
    saveToCloud: vi.fn(),
    saveProjectToCloud: vi.fn(),
    deleteFromCloud: vi.fn(),
    deleteProjectFromCloud: vi.fn(),
    setVisibility: mockSetVisibility,
    setProjectVisibility: vi.fn(),
    loadCloudProject: vi.fn(),
    fork: vi.fn(),
    dismissError: vi.fn(),
    initFromProject: vi.fn(),
    syncCloudProjects: vi.fn().mockResolvedValue({ updatedCount: 0, staleCloudIds: [] }),
    unlinkCloudProject: vi.fn(),
  }),
}));

vi.mock('../common/announcer', () => ({
  useAnnounce: () => mockAnnounce,
}));

vi.mock('../../utils/project-storage', () => ({
  getStorageUsage: () => ({ percent: 10, used: 100, total: 1000 }),
}));

describe('MyProjectsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects = [];
    mockActiveLocalId = null;
  });

  it('renders project list', () => {
    mockProjects = [
      makeProject({ localId: 'p1', name: 'Alpha' }),
      makeProject({ localId: 'p2', name: 'Beta' }),
    ];

    render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });

  it('shows filter input when more than 8 projects', () => {
    mockProjects = Array.from({ length: 9 }, (_, i) =>
      makeProject({ localId: `p${i}`, name: `Project ${i}` }),
    );

    render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByLabelText('Filter projects')).toBeInTheDocument();
  });

  it('does not show filter input when 8 or fewer projects', () => {
    mockProjects = Array.from({ length: 8 }, (_, i) =>
      makeProject({ localId: `p${i}`, name: `Project ${i}` }),
    );

    render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

    expect(screen.queryByLabelText('Filter projects')).not.toBeInTheDocument();
  });

  it('shows empty state when no projects', () => {
    mockProjects = [];

    render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByText('No projects yet.')).toBeInTheDocument();
    expect(screen.getByText('Create your first project')).toBeInTheDocument();
  });

  it('active project has aria-current attribute', () => {
    mockProjects = [
      makeProject({ localId: 'p1', name: 'Active Project' }),
      makeProject({ localId: 'p2', name: 'Other Project' }),
    ];
    mockActiveLocalId = 'p1';

    render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

    const activeItem = screen.getByText('Active Project').closest('li');
    expect(activeItem).toHaveAttribute('aria-current', 'true');

    const otherItem = screen.getByText('Other Project').closest('li');
    expect(otherItem).not.toHaveAttribute('aria-current');
  });

  it('"New Project" button is present', () => {
    render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /new project/i })).toBeInTheDocument();
  });
});
