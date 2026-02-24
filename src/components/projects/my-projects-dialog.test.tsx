import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const mockSaveProjectToCloud = vi.fn().mockResolvedValue(undefined);
const mockDeleteProjectFromCloud = vi.fn().mockResolvedValue(undefined);
const mockUnlinkCloudProject = vi.fn();
const mockSyncCloudProjects = vi.fn().mockResolvedValue({ updatedCount: 0, staleCloudIds: [] });

let mockProjects: ProjectListEntry[] = [];
let mockActiveLocalId: string | null = null;
let mockCloudEnabled = false;

vi.mock('../../context/app-context', () => ({
  useAppDispatch: () => vi.fn(),
}));

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
    saveProjectToCloud: mockSaveProjectToCloud,
    deleteFromCloud: vi.fn(),
    deleteProjectFromCloud: mockDeleteProjectFromCloud,
    setVisibility: mockSetVisibility,
    setProjectVisibility: vi.fn(),
    loadCloudProject: vi.fn(),
    fork: vi.fn(),
    dismissError: vi.fn(),
    initFromProject: vi.fn(),
    syncCloudProjects: mockSyncCloudProjects,
    unlinkCloudProject: mockUnlinkCloudProject,
  }),
}));

vi.mock('../common/announcer', () => ({
  useAnnounce: () => mockAnnounce,
}));

vi.mock('../../utils/project-storage', () => ({
  getStorageUsage: () => ({ percent: 10, used: 100, total: 1000 }),
  loadProject: vi.fn(() => null),
  saveProject: vi.fn(),
}));

vi.mock('../../utils/storage', () => ({
  sanitizeProjectMetadata: vi.fn((m: unknown) => m),
}));

vi.mock('../../utils/api-client', () => ({
  isCloudEnabled: () => mockCloudEnabled,
}));

describe('MyProjectsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects = [];
    mockActiveLocalId = null;
    mockCloudEnabled = false;
    mockSaveProjectToCloud.mockResolvedValue(undefined);
    mockDeleteProjectFromCloud.mockResolvedValue(undefined);
    mockSyncCloudProjects.mockResolvedValue({ updatedCount: 0, staleCloudIds: [] });
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

describe('MyProjectsDialog interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjects = [];
    mockActiveLocalId = null;
    mockCloudEnabled = false;
    mockSaveProjectToCloud.mockResolvedValue(undefined);
    mockDeleteProjectFromCloud.mockResolvedValue(undefined);
    mockSyncCloudProjects.mockResolvedValue({ updatedCount: 0, staleCloudIds: [] });
  });

  describe('creating a new project', () => {
    it('clicking "New Project" header button calls createNewProject and switchProject then closes', () => {
      const onClose = vi.fn();
      render(<MyProjectsDialog open={true} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: /new project/i }));

      expect(mockCreateNewProject).toHaveBeenCalledTimes(1);
      expect(mockSwitchProject).toHaveBeenCalledWith('new-id');
      expect(mockAnnounce).toHaveBeenCalledWith('New project created');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('clicking "Create your first project" button in empty state also creates and switches', () => {
      const onClose = vi.fn();
      mockProjects = [];
      render(<MyProjectsDialog open={true} onClose={onClose} />);

      fireEvent.click(screen.getByRole('button', { name: /create your first project/i }));

      expect(mockCreateNewProject).toHaveBeenCalledTimes(1);
      expect(mockSwitchProject).toHaveBeenCalledWith('new-id');
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleting a project', () => {
    it('clicking delete then confirming calls deleteLocalProject with correct id', () => {
      mockProjects = [makeProject({ localId: 'p1', name: 'My Project' })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Click the delete icon button — shows inline confirmation
      fireEvent.click(screen.getByRole('button', { name: 'Delete project My Project' }));

      // The inline DeleteConfirmation should now be visible
      expect(screen.getByRole('alertdialog', { name: 'Confirm deletion of My Project' })).toBeInTheDocument();

      // Confirm deletion
      fireEvent.click(screen.getByRole('button', { name: 'Delete project My Project' }));

      expect(mockDeleteLocalProject).toHaveBeenCalledWith('p1');
      expect(mockAnnounce).toHaveBeenCalledWith('Project "My Project" deleted');
    });

    it('clicking delete then cancelling does not call deleteLocalProject', () => {
      mockProjects = [makeProject({ localId: 'p1', name: 'My Project' })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Delete project My Project' }));
      expect(screen.getByRole('alertdialog', { name: 'Confirm deletion of My Project' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel deletion' }));

      expect(mockDeleteLocalProject).not.toHaveBeenCalled();
      // Inline confirm UI should be gone; delete button should be back
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    });
  });

  describe('renaming a project', () => {
    it('clicking the project name button enters edit mode', async () => {
      mockProjects = [makeProject({ localId: 'p1', name: 'Alpha' })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // The name renders as a button in view mode
      fireEvent.click(screen.getByRole('button', { name: 'Rename project Alpha' }));

      // In edit mode an input replaces the button
      expect(screen.getByRole('textbox', { name: 'Rename project Alpha' })).toBeInTheDocument();
    });

    it('typing a new name and pressing Enter commits the rename', () => {
      mockProjects = [makeProject({ localId: 'p1', name: 'Alpha' })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Rename project Alpha' }));

      const input = screen.getByRole('textbox', { name: 'Rename project Alpha' });
      fireEvent.change(input, { target: { value: 'Beta' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(mockRenameProject).toHaveBeenCalledWith('p1', 'Beta');
      expect(mockAnnounce).toHaveBeenCalledWith('Project renamed to "Beta"');
    });

    it('pressing Escape cancels the rename without calling renameProject', () => {
      mockProjects = [makeProject({ localId: 'p1', name: 'Alpha' })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      fireEvent.click(screen.getByRole('button', { name: 'Rename project Alpha' }));

      const input = screen.getByRole('textbox', { name: 'Rename project Alpha' });
      fireEvent.change(input, { target: { value: 'Something else' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(mockRenameProject).not.toHaveBeenCalled();
      // View-mode button should be back
      expect(screen.getByRole('button', { name: 'Rename project Alpha' })).toBeInTheDocument();
    });
  });

  describe('opening / switching to a project', () => {
    it('clicking the Open button calls switchProject and closes the dialog', () => {
      const onClose = vi.fn();
      mockProjects = [
        makeProject({ localId: 'p1', name: 'Active' }),
        makeProject({ localId: 'p2', name: 'Other' }),
      ];
      mockActiveLocalId = 'p1';
      render(<MyProjectsDialog open={true} onClose={onClose} />);

      // Open button is only rendered for non-active projects
      fireEvent.click(screen.getByRole('button', { name: 'Open project Other' }));

      expect(mockSwitchProject).toHaveBeenCalledWith('p2');
      expect(mockAnnounce).toHaveBeenCalledWith('Project opened');
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('does not show an Open button for the active project', () => {
      mockProjects = [makeProject({ localId: 'p1', name: 'Active' })];
      mockActiveLocalId = 'p1';
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      expect(screen.queryByRole('button', { name: 'Open project Active' })).not.toBeInTheDocument();
    });
  });

  describe('cloud operations — save to cloud', () => {
    it('clicking "Save to cloud" opens the FirstTimeCloudPrompt confirmation dialog', async () => {
      mockCloudEnabled = true;
      mockProjects = [makeProject({ localId: 'p1', name: 'My Project', isCloudSaved: false })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Drain async effects (syncCloudProjects) before interacting
      await waitFor(() => expect(mockSyncCloudProjects).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Save project My Project to cloud' }));

      // FirstTimeCloudPrompt renders a ConfirmationDialog with title "Save to Cloud"
      expect(screen.getByRole('heading', { name: 'Save to Cloud' })).toBeInTheDocument();
    });

    it('confirming the save-to-cloud dialog calls saveProjectToCloud', async () => {
      mockCloudEnabled = true;
      mockProjects = [makeProject({ localId: 'p1', name: 'My Project', isCloudSaved: false })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Drain async effects (syncCloudProjects) before interacting
      await waitFor(() => expect(mockSyncCloudProjects).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Save project My Project to cloud' }));

      // Confirm inside the FirstTimeCloudPrompt
      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));

      await waitFor(() => {
        expect(mockSaveProjectToCloud).toHaveBeenCalledWith('p1');
      });
      expect(mockAnnounce).toHaveBeenCalledWith('Saved to cloud');
    });

    it('cancelling the save-to-cloud dialog does not call saveProjectToCloud', async () => {
      mockCloudEnabled = true;
      mockProjects = [makeProject({ localId: 'p1', name: 'My Project', isCloudSaved: false })];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Drain async effects (syncCloudProjects) before interacting
      await waitFor(() => expect(mockSyncCloudProjects).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Save project My Project to cloud' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockSaveProjectToCloud).not.toHaveBeenCalled();
    });
  });

  describe('cloud operations — unlink from cloud', () => {
    it('clicking "Remove link" for a stale cloud project calls unlinkCloudProject immediately', async () => {
      mockCloudEnabled = true;
      // Make syncCloudProjects return a stale cloud ID so the project is marked stale
      mockSyncCloudProjects.mockResolvedValue({ updatedCount: 0, staleCloudIds: ['cloud-123'] });
      mockProjects = [
        makeProject({
          localId: 'p1',
          name: 'Stale Project',
          cloudId: 'cloud-123',
          isCloudSaved: true,
        }),
      ];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Wait for the async syncCloudProjects to resolve and staleCloudIds state to update
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Remove link' })).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Remove link' }));

      expect(mockUnlinkCloudProject).toHaveBeenCalledWith('p1');
      expect(mockAnnounce).toHaveBeenCalledWith('Cloud link removed');
    });
  });

  describe('cloud operations — remove from cloud', () => {
    it('clicking "Remove from cloud" shows the confirmation dialog', async () => {
      mockCloudEnabled = true;
      mockProjects = [
        makeProject({
          localId: 'p1',
          name: 'Cloud Project',
          cloudId: 'cloud-abc',
          isCloudSaved: true,
        }),
      ];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Drain async effects (syncCloudProjects) before interacting
      await waitFor(() => expect(mockSyncCloudProjects).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Remove project Cloud Project from cloud' }));

      expect(screen.getByRole('heading', { name: 'Remove from Cloud' })).toBeInTheDocument();
      expect(screen.getByText(/This will delete the cloud copy/)).toBeInTheDocument();
    });

    it('confirming "Remove from Cloud" calls deleteProjectFromCloud', async () => {
      mockCloudEnabled = true;
      mockProjects = [
        makeProject({
          localId: 'p1',
          name: 'Cloud Project',
          cloudId: 'cloud-abc',
          isCloudSaved: true,
        }),
      ];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Drain async effects (syncCloudProjects) before interacting
      await waitFor(() => expect(mockSyncCloudProjects).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Remove project Cloud Project from cloud' }));
      fireEvent.click(screen.getByRole('button', { name: 'Remove from Cloud' }));

      await waitFor(() => {
        expect(mockDeleteProjectFromCloud).toHaveBeenCalledWith('cloud-abc');
      });
      expect(mockAnnounce).toHaveBeenCalledWith('Removed from cloud');
    });

    it('cancelling the remove-from-cloud dialog does not call deleteProjectFromCloud', async () => {
      mockCloudEnabled = true;
      mockProjects = [
        makeProject({
          localId: 'p1',
          name: 'Cloud Project',
          cloudId: 'cloud-abc',
          isCloudSaved: true,
        }),
      ];
      render(<MyProjectsDialog open={true} onClose={vi.fn()} />);

      // Drain async effects (syncCloudProjects) before interacting
      await waitFor(() => expect(mockSyncCloudProjects).toHaveBeenCalled());

      fireEvent.click(screen.getByRole('button', { name: 'Remove project Cloud Project from cloud' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockDeleteProjectFromCloud).not.toHaveBeenCalled();
    });
  });
});
