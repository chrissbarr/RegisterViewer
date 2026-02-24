import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { useMyProjectsActions } from './use-my-projects-actions';
import { DEFAULT_PROJECT_NAME } from '../types/project';

const mockProjects = [
  { localId: 'local-1', name: 'Project A', isCloudSaved: true, cloudId: 'cloud-1' },
  { localId: 'local-2', name: 'Project B', isCloudSaved: false, cloudId: null },
];

const mockStorageActions = {
  createNewProject: vi.fn(() => 'new-id'),
  switchProject: vi.fn(),
  deleteLocalProject: vi.fn(),
  renameProject: vi.fn(),
  refreshProjectList: vi.fn(),
};

const mockCloudActions = {
  setProjectVisibility: vi.fn(),
  syncCloudProjects: vi.fn(() => Promise.resolve({ staleCloudIds: [], updatedCount: 0 })),
  deleteProjectFromCloud: vi.fn(),
  unlinkCloudProject: vi.fn(),
  saveProjectToCloud: vi.fn(),
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

vi.mock('../components/common/announcer', () => ({
  useAnnounce: vi.fn(() => mockAnnounce),
}));

vi.mock('../utils/api-client', () => ({
  isCloudEnabled: vi.fn(() => true),
}));

vi.mock('../utils/owner-token', () => ({
  getOrCreateOwnerToken: vi.fn(() => 'mock-token'),
}));

vi.mock('../utils/project-storage', () => ({
  loadProject: vi.fn(() => null),
  saveProject: vi.fn(),
}));

vi.mock('../utils/storage', () => ({
  sanitizeProjectMetadata: vi.fn((m: unknown) => m),
}));

import { isCloudEnabled } from '../utils/api-client';
import { getOrCreateOwnerToken } from '../utils/owner-token';

beforeEach(() => {
  vi.clearAllMocks();
  (isCloudEnabled as Mock).mockReturnValue(true);
  (getOrCreateOwnerToken as Mock).mockReturnValue('mock-token');
  mockStorageActions.createNewProject.mockReturnValue('new-id');
  mockCloudActions.syncCloudProjects.mockResolvedValue({ staleCloudIds: [], updatedCount: 0 });
});

describe('useMyProjectsActions', () => {
  describe('dialog lifecycle', () => {
    it('refreshes project list when dialog opens', () => {
      const onClose = vi.fn();
      renderHook(() => useMyProjectsActions(true, onClose));
      expect(mockStorageActions.refreshProjectList).toHaveBeenCalled();
    });

    it('syncs cloud projects when open and cloud enabled', async () => {
      const onClose = vi.fn();
      renderHook(() => useMyProjectsActions(true, onClose));
      // syncCloudProjects is called in useEffect
      await vi.waitFor(() => {
        expect(mockCloudActions.syncCloudProjects).toHaveBeenCalled();
      });
    });

    it('sets cloudError when syncCloudProjects fails', async () => {
      mockCloudActions.syncCloudProjects.mockRejectedValue(new Error('Network error'));
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      await vi.waitFor(() => {
        expect(result.current.cloudError).toBe('Network error');
      });
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
    it('handleNewProject creates, switches, announces, and closes', () => {
      const onClose = vi.fn();
      const onBeforeNew = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose, undefined, onBeforeNew));

      act(() => {
        result.current.handleNewProject();
      });

      expect(mockStorageActions.createNewProject).toHaveBeenCalled();
      expect(mockStorageActions.switchProject).toHaveBeenCalledWith('new-id');
      expect(mockAnnounce).toHaveBeenCalledWith('New project created');
      expect(onBeforeNew).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalled();
    });

    it('handleOpen switches project and closes dialog', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleOpen('local-1');
      });

      expect(mockStorageActions.switchProject).toHaveBeenCalledWith('local-1');
      expect(mockAnnounce).toHaveBeenCalledWith('Project opened');
      expect(onClose).toHaveBeenCalled();
    });

    it('handleDelete removes project and announces with name', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleDelete('local-1');
      });

      expect(mockStorageActions.deleteLocalProject).toHaveBeenCalledWith('local-1');
      expect(mockAnnounce).toHaveBeenCalledWith('Project "Project A" deleted');
    });

    it('handleDelete uses fallback name for unknown project', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleDelete('unknown-id');
      });

      expect(mockAnnounce).toHaveBeenCalledWith(`Project "${DEFAULT_PROJECT_NAME}" deleted`);
    });

    it('handleRename renames and announces', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleRename('local-1', 'New Name');
      });

      expect(mockStorageActions.renameProject).toHaveBeenCalledWith('local-1', 'New Name');
      expect(mockAnnounce).toHaveBeenCalledWith('Project renamed to "New Name"');
    });
  });

  describe('share', () => {
    it('handleShare calls onShareProject callback', () => {
      const onClose = vi.fn();
      const onShare = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose, onShare));

      act(() => {
        result.current.handleShare('local-1');
      });

      expect(onShare).toHaveBeenCalledWith('local-1');
    });
  });

  describe('cloud visibility', () => {
    it('handleChangeVisibility sets visibility and announces', async () => {
      const onClose = vi.fn();
      mockCloudActions.setProjectVisibility.mockResolvedValue(undefined);
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      await act(async () => {
        await result.current.handleChangeVisibility('local-1', 'unlisted');
      });

      expect(mockCloudActions.setProjectVisibility).toHaveBeenCalledWith('local-1', 'unlisted');
      expect(mockAnnounce).toHaveBeenCalledWith('Visibility changed to unlisted');
    });

    it('handleChangeVisibility sets cloudError on failure', async () => {
      const onClose = vi.fn();
      mockCloudActions.setProjectVisibility.mockRejectedValue(new Error('Network fail'));
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      await act(async () => {
        await result.current.handleChangeVisibility('local-1', 'unlisted');
      });

      expect(result.current.cloudError).toBe('Network fail');
    });
  });

  describe('save to cloud flow', () => {
    it('handleSaveToCloud opens confirmation', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleSaveToCloud('local-1');
      });

      expect(result.current.isSaveToCloudOpen).toBe(true);
    });

    it('handleConfirmSaveToCloud saves and announces', async () => {
      const onClose = vi.fn();
      mockCloudActions.saveProjectToCloud.mockResolvedValue(undefined);
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleSaveToCloud('local-1');
      });

      await act(async () => {
        await result.current.handleConfirmSaveToCloud();
      });

      expect(mockCloudActions.saveProjectToCloud).toHaveBeenCalledWith('local-1');
      expect(mockAnnounce).toHaveBeenCalledWith('Saved to cloud');
      expect(result.current.isSaveToCloudOpen).toBe(false);
    });

    it('handleConfirmSaveToCloud sets cloudError on failure', async () => {
      const onClose = vi.fn();
      mockCloudActions.saveProjectToCloud.mockRejectedValue(new Error('Save failed'));
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleSaveToCloud('local-1');
      });

      await act(async () => {
        await result.current.handleConfirmSaveToCloud();
      });

      expect(result.current.cloudError).toBe('Save failed');
    });

    it('dismissSaveToCloud clears confirmation', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleSaveToCloud('local-1');
      });
      expect(result.current.isSaveToCloudOpen).toBe(true);

      act(() => {
        result.current.dismissSaveToCloud();
      });
      expect(result.current.isSaveToCloudOpen).toBe(false);
    });
  });

  describe('cloud delete flow', () => {
    it('handleRemoveFromCloud opens delete confirmation for cloud projects', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleRemoveFromCloud('local-1');
      });

      expect(result.current.isDeleteCloudConfirmOpen).toBe(true);
    });

    it('handleRemoveFromCloud does nothing for non-cloud projects', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleRemoveFromCloud('local-2');
      });

      expect(result.current.isDeleteCloudConfirmOpen).toBe(false);
    });

    it('handleConfirmCloudDelete deletes and announces', async () => {
      const onClose = vi.fn();
      mockCloudActions.deleteProjectFromCloud.mockResolvedValue(undefined);
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleRemoveFromCloud('local-1');
      });

      await act(async () => {
        await result.current.handleConfirmCloudDelete();
      });

      expect(mockCloudActions.deleteProjectFromCloud).toHaveBeenCalledWith('cloud-1');
      expect(mockAnnounce).toHaveBeenCalledWith('Removed from cloud');
      expect(result.current.isDeleteCloudConfirmOpen).toBe(false);
    });

    it('dismissDeleteCloudConfirm clears confirmation', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleRemoveFromCloud('local-1');
      });

      act(() => {
        result.current.dismissDeleteCloudConfirm();
      });

      expect(result.current.isDeleteCloudConfirmOpen).toBe(false);
    });
  });

  describe('unlink cloud', () => {
    it('handleUnlinkCloud unlinks and announces', () => {
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleUnlinkCloud('local-1');
      });

      expect(mockCloudActions.unlinkCloudProject).toHaveBeenCalledWith('local-1');
      expect(mockStorageActions.refreshProjectList).toHaveBeenCalled();
      expect(mockAnnounce).toHaveBeenCalledWith('Cloud link removed');
    });
  });

  describe('recovery key', () => {
    it('handleDownloadRecoveryKey creates download link', () => {
      vi.useFakeTimers();
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      // Mock createElement AFTER renderHook so jsdom can set up the test component
      const mockClick = vi.fn();
      const realCreateElement = document.createElement.bind(document);
      const mockCreateElement = vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
        if (tag === 'a') {
          return { href: '', download: '', click: mockClick } as unknown as HTMLAnchorElement;
        }
        return realCreateElement(tag);
      });
      const mockCreateObjectURL = vi.fn(() => 'blob:url');
      const mockRevokeObjectURL = vi.fn();
      globalThis.URL.createObjectURL = mockCreateObjectURL;
      globalThis.URL.revokeObjectURL = mockRevokeObjectURL;

      act(() => {
        result.current.handleDownloadRecoveryKey();
      });

      expect(mockClick).toHaveBeenCalled();
      // revokeObjectURL is deferred via setTimeout to ensure the browser initiates the download
      vi.runAllTimers();
      expect(mockRevokeObjectURL).toHaveBeenCalledWith('blob:url');
      expect(mockAnnounce).toHaveBeenCalledWith('Recovery key downloaded');

      mockCreateElement.mockRestore();
      vi.useRealTimers();
    });

    it('announces error when no token available', () => {
      (getOrCreateOwnerToken as Mock).mockReturnValue(null);
      const onClose = vi.fn();
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

      act(() => {
        result.current.handleDownloadRecoveryKey();
      });

      expect(mockAnnounce).toHaveBeenCalledWith('No recovery key found', { politeness: 'assertive' });
    });
  });

  describe('dismissals', () => {
    it('dismissCloudError clears error', async () => {
      const onClose = vi.fn();
      mockCloudActions.setProjectVisibility.mockRejectedValue(new Error('err'));
      const { result } = renderHook(() => useMyProjectsActions(true, onClose));

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
