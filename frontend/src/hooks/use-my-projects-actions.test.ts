import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useMyProjectsActions } from './use-my-projects-actions';
import { DEFAULT_PROJECT_NAME } from '../types/project';

const mockProjects = [
  { localId: 'local-1', name: 'Project A', storage: 'cloud', cloudId: 'cloud-1', visibility: 'private', createdAt: '2026-01-01', localSavedAt: '2026-01-01', cloudSavedAt: '2026-01-01' },
  { localId: 'local-2', name: 'Project B', storage: 'local', cloudId: null, visibility: 'private', createdAt: '2026-01-01', localSavedAt: '2026-01-01', cloudSavedAt: null },
];

const mockStorageActions = {
  createNewProject: vi.fn(() => 'new-id'),
  switchProject: vi.fn(() => true),
  deleteLocalProject: vi.fn(),
  renameProject: vi.fn(),
  refreshProjectList: vi.fn(),
};

const mockCloudActions = {
  setProjectVisibility: vi.fn(),
  syncCloudProjects: vi.fn(() => Promise.resolve({ staleCloudIds: [], updatedCount: 0, placeholdersCreated: 0 })),
  deleteProjectFromCloud: vi.fn(),
};

const mockAnnounce = vi.fn();

vi.mock('../context/project-storage-context', () => ({
  useProjectStorage: vi.fn(() => ({ activeLocalId: 'local-1', projects: mockProjects })),
  useProjectStorageActions: vi.fn(() => mockStorageActions),
}));

vi.mock('../context/app-context', () => ({
  useAppDispatch: vi.fn(() => vi.fn()),
}));

vi.mock('../context/cloud-sync-context', () => ({
  useCloudSyncActions: vi.fn(() => mockCloudActions),
}));

vi.mock('../context/auth-context', () => ({
  useAuthActions: vi.fn(() => ({ getJwt: vi.fn(() => null) })),
}));

vi.mock('../components/common/announcer', () => ({
  useAnnounce: vi.fn(() => mockAnnounce),
}));

vi.mock('../utils/api-client', () => ({
  isCloudEnabled: vi.fn(() => true),
}));

vi.mock('../utils/project-storage', () => ({
  loadProject: vi.fn(() => null),
  saveProject: vi.fn(() => ({ ok: true, status: 'ok', evictedLocalIds: [] })),
  hasLocalData: vi.fn(() => true),
}));

vi.mock('../utils/cloud-project-loader', () => ({
  fetchAndParseCloudProject: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  sanitizeProjectMetadata: vi.fn((m: unknown) => m),
}));

import { isCloudEnabled } from '../utils/api-client';

beforeEach(() => {
  vi.clearAllMocks();
  (isCloudEnabled as Mock).mockReturnValue(true);
  mockStorageActions.createNewProject.mockReturnValue('new-id');
  mockStorageActions.switchProject.mockReturnValue(true);
  mockCloudActions.syncCloudProjects.mockResolvedValue({ staleCloudIds: [], updatedCount: 0, placeholdersCreated: 0 });
});

/** Render the hook with open=true and flush the async cloud-sync useEffect. */
async function renderWithOpen(onClose: () => void, onBeforeNew?: () => void) {
  const result = renderHook(() => useMyProjectsActions(true, onClose, onBeforeNew));
  await act(async () => {}); // flush async useEffect (syncCloudProjects promise)
  return result;
}

describe('useMyProjectsActions', () => {
  describe('dialog lifecycle', () => {
    it('refreshes project list when dialog opens', async () => {
      const onClose = vi.fn();
      await renderWithOpen(onClose);
      expect(mockStorageActions.refreshProjectList).toHaveBeenCalled();
    });

    it('syncs cloud projects when open and cloud enabled', async () => {
      const onClose = vi.fn();
      await renderWithOpen(onClose);
      expect(mockCloudActions.syncCloudProjects).toHaveBeenCalled();
    });

    it('sets cloudError when syncCloudProjects fails', async () => {
      mockCloudActions.syncCloudProjects.mockRejectedValue(new Error('Network error'));
      const onClose = vi.fn();
      const { result } = await renderWithOpen(onClose);

      expect(result.current.cloudError).toBe('Network error');
    });

    it('does not sync cloud when cloud is disabled', () => {
      (isCloudEnabled as Mock).mockReturnValue(false);
      const onClose = vi.fn();
      renderHook(() => useMyProjectsActions(true, onClose));
      expect(mockCloudActions.syncCloudProjects).not.toHaveBeenCalled();
    });

    it('does not refresh when dialog is closed', () => {
      const onClose = vi.fn();
      renderHook(() => useMyProjectsActions(false, onClose));
      expect(mockStorageActions.refreshProjectList).not.toHaveBeenCalled();
    });
  });

  describe('project CRUD', () => {
    it('handleNewProject creates, switches, announces, and closes', async () => {
      const onClose = vi.fn();
      const onBeforeNew = vi.fn();
      const { result } = await renderWithOpen(onClose, onBeforeNew);

      act(() => {
        result.current.handleNewProject();
      });

      expect(mockStorageActions.createNewProject).toHaveBeenCalled();
      expect(mockStorageActions.switchProject).toHaveBeenCalledWith('new-id');
      expect(mockAnnounce).toHaveBeenCalledWith('New project created');
      expect(onBeforeNew).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('handleOpen switches project and closes dialog', async () => {
      const onClose = vi.fn();
      const { result } = await renderWithOpen(onClose);

      act(() => {
        result.current.handleOpen('local-1');
      });

      expect(mockStorageActions.switchProject).toHaveBeenCalledWith('local-1');
      expect(mockAnnounce).toHaveBeenCalledWith('Project opened');
      expect(onClose).toHaveBeenCalled();
    });

    it('handleDelete deletes from cloud and locally for cloud-backed project', async () => {
      const onClose = vi.fn();
      mockCloudActions.deleteProjectFromCloud.mockResolvedValue(undefined);
      const { result } = await renderWithOpen(onClose);

      await act(async () => {
        await result.current.handleDelete('local-1');
      });

      expect(mockCloudActions.deleteProjectFromCloud).toHaveBeenCalledWith('cloud-1');
      expect(mockStorageActions.deleteLocalProject).toHaveBeenCalledWith('local-1');
      expect(mockAnnounce).toHaveBeenCalledWith('Project "Project A" deleted');
    });

    it('handleDelete deletes locally only for non-cloud project', async () => {
      const onClose = vi.fn();
      const { result } = await renderWithOpen(onClose);

      await act(async () => {
        await result.current.handleDelete('local-2');
      });

      expect(mockCloudActions.deleteProjectFromCloud).not.toHaveBeenCalled();
      expect(mockStorageActions.deleteLocalProject).toHaveBeenCalledWith('local-2');
    });

    it('handleDelete still deletes locally if cloud delete fails', async () => {
      const onClose = vi.fn();
      mockCloudActions.deleteProjectFromCloud.mockRejectedValue(new Error('fail'));
      const { result } = await renderWithOpen(onClose);

      await act(async () => {
        await result.current.handleDelete('local-1');
      });

      expect(mockStorageActions.deleteLocalProject).toHaveBeenCalledWith('local-1');
      expect(mockAnnounce).toHaveBeenCalledWith('Project "Project A" deleted');
    });

    it('handleDelete uses fallback name for unknown project', async () => {
      const onClose = vi.fn();
      const { result } = await renderWithOpen(onClose);

      await act(async () => {
        await result.current.handleDelete('unknown-id');
      });

      expect(mockAnnounce).toHaveBeenCalledWith(`Project "${DEFAULT_PROJECT_NAME}" deleted`);
    });

    it('handleRename renames and announces', async () => {
      const onClose = vi.fn();
      const { result } = await renderWithOpen(onClose);

      act(() => {
        result.current.handleRename('local-1', 'New Name');
      });

      expect(mockStorageActions.renameProject).toHaveBeenCalledWith('local-1', 'New Name');
      expect(mockAnnounce).toHaveBeenCalledWith('Project renamed to "New Name"');
    });
  });

  describe('share', () => {
    it('handleShare sets shareLocalId', async () => {
      const onClose = vi.fn();
      const { result } = await renderWithOpen(onClose);

      expect(result.current.shareLocalId).toBeNull();

      act(() => {
        result.current.handleShare('local-1');
      });

      expect(result.current.shareLocalId).toBe('local-1');
    });

    it('dismissShare clears shareLocalId', async () => {
      const onClose = vi.fn();
      const { result } = await renderWithOpen(onClose);

      act(() => {
        result.current.handleShare('local-1');
      });
      expect(result.current.shareLocalId).toBe('local-1');

      act(() => {
        result.current.dismissShare();
      });
      expect(result.current.shareLocalId).toBeNull();
    });
  });

  describe('cloud visibility', () => {
    it('handleChangeVisibility sets visibility and announces', async () => {
      const onClose = vi.fn();
      mockCloudActions.setProjectVisibility.mockResolvedValue(undefined);
      const { result } = await renderWithOpen(onClose);

      await act(async () => {
        await result.current.handleChangeVisibility('local-1', 'unlisted');
      });

      expect(mockCloudActions.setProjectVisibility).toHaveBeenCalledWith('local-1', 'unlisted');
      expect(mockAnnounce).toHaveBeenCalledWith('Visibility changed to unlisted');
    });

    it('handleChangeVisibility sets cloudError on failure', async () => {
      const onClose = vi.fn();
      mockCloudActions.setProjectVisibility.mockRejectedValue(new Error('Network fail'));
      const { result } = await renderWithOpen(onClose);

      await act(async () => {
        await result.current.handleChangeVisibility('local-1', 'unlisted');
      });

      expect(result.current.cloudError).toBe('Network fail');
    });
  });

  describe('dismissals', () => {
    it('dismissCloudError clears error', async () => {
      const onClose = vi.fn();
      mockCloudActions.setProjectVisibility.mockRejectedValue(new Error('err'));
      const { result } = await renderWithOpen(onClose);

      await act(async () => {
        await result.current.handleChangeVisibility('local-1', 'unlisted');
      });
      expect(result.current.cloudError).toBe('err');

      act(() => {
        result.current.dismissCloudError();
      });
      expect(result.current.cloudError).toBeNull();
    });
  });
});
