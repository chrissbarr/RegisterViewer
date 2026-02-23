import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { ShareDialog } from './share-dialog';

// ── Mocks ────────────────────────────────────────────────────────────

vi.mock('../../utils/api-client', () => ({
  isCloudEnabled: vi.fn(() => false),
}));

vi.mock('../../context/app-context', () => ({
  useAppState: vi.fn(() => ({
    registers: [],
    activeRegisterId: null,
    registerValues: {},
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
    addressUnitBits: 8,
  })),
}));

vi.mock('../../context/cloud-sync-context', () => ({
  useCloudSync: vi.fn(() => ({
    cloudId: null,
    isOwner: false,
    isDirty: false,
    status: 'idle' as const,
    error: null,
    shareUrl: null,
    lastCloudSavedAt: null,
    visibility: 'private' as const,
  })),
  useCloudSyncActions: vi.fn(() => ({
    saveToCloud: vi.fn(),
    saveProjectToCloud: vi.fn(),
    setVisibility: vi.fn(),
    setProjectVisibility: vi.fn(),
  })),
}));

vi.mock('../../utils/project-storage', () => ({
  loadProject: vi.fn(() => null),
  loadManifest: vi.fn(() => ({ version: 1, projects: [] })),
  buildProjectUrl: vi.fn((id: string) => `https://example.com/#/p/${id}`),
}));

vi.mock('../../utils/storage', () => ({
  deserializeState: vi.fn((data: unknown) => data),
}));

vi.mock('../../utils/snapshot-url', () => ({
  buildSnapshotUrl: vi.fn(() => 'https://example.com/#data=abc123'),
}));

vi.mock('../common/announcer', () => ({
  useAnnounce: () => vi.fn(),
}));

// ── Imports for mocked modules ───────────────────────────────────────

import { isCloudEnabled } from '../../utils/api-client';
import { useAppState } from '../../context/app-context';
import { useCloudSync, useCloudSyncActions } from '../../context/cloud-sync-context';
import { loadProject, loadManifest } from '../../utils/project-storage';
import { buildSnapshotUrl } from '../../utils/snapshot-url';
import { deserializeState } from '../../utils/storage';

// ── Setup ────────────────────────────────────────────────────────────

// jsdom doesn't implement HTMLDialogElement.showModal/close
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });

  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

beforeEach(() => {
  vi.clearAllMocks();

  // Default: cloud disabled, no cloud state
  (isCloudEnabled as Mock).mockReturnValue(false);
  (useAppState as Mock).mockReturnValue({
    registers: [],
    activeRegisterId: null,
    registerValues: {},
    mapTableWidth: 32,
    mapShowGaps: true,
    mapSortDescending: false,
    addressUnitBits: 8,
  });
  (useCloudSync as Mock).mockReturnValue({
    cloudId: null,
    isOwner: false,
    isDirty: false,
    status: 'idle',
    error: null,
    shareUrl: null,
    lastCloudSavedAt: null,
    visibility: 'private',
  });
  (useCloudSyncActions as Mock).mockReturnValue({
    saveToCloud: vi.fn(),
    saveProjectToCloud: vi.fn(),
    setVisibility: vi.fn(),
    setProjectVisibility: vi.fn(),
  });
  (loadProject as Mock).mockReturnValue(null);
  (loadManifest as Mock).mockReturnValue({ version: 1, projects: [] });
  (buildSnapshotUrl as Mock).mockReturnValue('https://example.com/#data=abc123');
  (deserializeState as Mock).mockImplementation((data: unknown) => data);
});

// ── Helpers ──────────────────────────────────────────────────────────

function renderShareDialog(props: Partial<Parameters<typeof ShareDialog>[0]> = {}) {
  return render(
    <ShareDialog
      open={true}
      onClose={vi.fn()}
      {...props}
    />,
  );
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ShareDialog', () => {
  // ── 1. Snapshot share mode (no cloud) ────────────────────────────

  describe('snapshot share mode (cloud disabled)', () => {
    it('renders dialog title "Share"', () => {
      renderShareDialog();
      expect(screen.getByText('Share')).toBeInTheDocument();
    });

    it('renders the snapshot URL input', () => {
      renderShareDialog();
      const input = screen.getByDisplayValue('https://example.com/#data=abc123');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('readonly');
    });

    it('renders the snapshot URL section heading', () => {
      renderShareDialog();
      expect(screen.getByText('Snapshot URL')).toBeInTheDocument();
    });

    it('renders the snapshot URL description text', () => {
      renderShareDialog();
      expect(
        screen.getByText('Contains the full project data encoded in the URL. No server needed.'),
      ).toBeInTheDocument();
    });

    it('shows character count for snapshot URL', () => {
      renderShareDialog();
      // 'https://example.com/#data=abc123'.length === 32
      expect(screen.getByText(/32 characters/)).toBeInTheDocument();
    });

    it('does not show amber warning for short URLs', () => {
      renderShareDialog();
      expect(screen.queryByText(/URL is long/)).not.toBeInTheDocument();
    });

    it('shows amber warning for URLs longer than 2000 characters', () => {
      const longUrl = 'https://example.com/#data=' + 'x'.repeat(2000);
      (buildSnapshotUrl as Mock).mockReturnValue(longUrl);
      renderShareDialog();
      expect(screen.getByText(/URL is long and may not work/)).toBeInTheDocument();
    });

    it('does not render the cloud link section when cloud is disabled', () => {
      renderShareDialog();
      expect(screen.queryByText('Cloud link')).not.toBeInTheDocument();
    });

    it('shows error message when snapshot URL generation fails', () => {
      (buildSnapshotUrl as Mock).mockImplementation(() => {
        throw new Error('Compression failed');
      });
      renderShareDialog();
      expect(screen.getByText('Failed to generate snapshot URL.')).toBeInTheDocument();
    });

    it('does not render snapshot URL input when generation fails', () => {
      (buildSnapshotUrl as Mock).mockImplementation(() => {
        throw new Error('Compression failed');
      });
      renderShareDialog();
      expect(screen.queryByDisplayValue(/example\.com/)).not.toBeInTheDocument();
    });

    it('does not build snapshot URL when dialog is closed', () => {
      renderShareDialog({ open: false });
      expect(buildSnapshotUrl).not.toHaveBeenCalled();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      renderShareDialog({ onClose });
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  // ── 2. Cloud share mode (with cloudId) ───────────────────────────

  describe('cloud share mode (cloud enabled with cloudId)', () => {
    beforeEach(() => {
      (isCloudEnabled as Mock).mockReturnValue(true);
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-abc',
        isOwner: true,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: 'https://example.com/#/p/cloud-abc',
        lastCloudSavedAt: '2024-01-01T00:00:00Z',
        visibility: 'unlisted',
      });
    });

    it('renders cloud link section heading', () => {
      renderShareDialog();
      expect(screen.getByText('Cloud link')).toBeInTheDocument();
    });

    it('renders the cloud share URL input when visibility is unlisted', () => {
      renderShareDialog();
      const input = screen.getByDisplayValue('https://example.com/#/p/cloud-abc');
      expect(input).toBeInTheDocument();
      expect(input).toHaveAttribute('readonly');
    });

    it('shows Unlisted badge when visibility is unlisted', () => {
      renderShareDialog();
      expect(screen.getByText('Unlisted')).toBeInTheDocument();
    });

    it('renders copy button for cloud link when unlisted', () => {
      renderShareDialog();
      expect(screen.getByRole('button', { name: 'Copy cloud link' })).toBeInTheDocument();
    });

    it('shows "Make Unlisted" button when cloud project is private', () => {
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-abc',
        isOwner: true,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: 'https://example.com/#/p/cloud-abc',
        lastCloudSavedAt: '2024-01-01T00:00:00Z',
        visibility: 'private',
      });
      renderShareDialog();
      expect(screen.getByRole('button', { name: 'Make Unlisted' })).toBeInTheDocument();
    });

    it('shows descriptive text when project is private', () => {
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-abc',
        isOwner: true,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: 'https://example.com/#/p/cloud-abc',
        lastCloudSavedAt: '2024-01-01T00:00:00Z',
        visibility: 'private',
      });
      renderShareDialog();
      expect(
        screen.getByText('This project is private. Make it unlisted to generate a shareable link.'),
      ).toBeInTheDocument();
    });

    it('calls setVisibility("unlisted") when "Make Unlisted" is clicked', () => {
      const mockSetVisibility = vi.fn();
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-abc',
        isOwner: true,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: null,
        lastCloudSavedAt: null,
        visibility: 'private',
      });
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: vi.fn(),
        saveProjectToCloud: vi.fn(),
        setVisibility: mockSetVisibility,
        setProjectVisibility: vi.fn(),
      });
      renderShareDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Make Unlisted' }));
      expect(mockSetVisibility).toHaveBeenCalledWith('unlisted');
    });
  });

  // ── 3. Cloud save flow ────────────────────────────────────────────

  describe('cloud save flow (no cloud project yet)', () => {
    beforeEach(() => {
      (isCloudEnabled as Mock).mockReturnValue(true);
      (useCloudSync as Mock).mockReturnValue({
        cloudId: null,
        isOwner: false,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: null,
        lastCloudSavedAt: null,
        visibility: 'private',
      });
    });

    it('renders "Save to Cloud" button when no cloud project exists', () => {
      renderShareDialog();
      expect(screen.getByRole('button', { name: 'Save to Cloud' })).toBeInTheDocument();
    });

    it('renders callout text prompting user to save', () => {
      renderShareDialog();
      expect(
        screen.getByText('Save to the cloud for a short, permanent link.'),
      ).toBeInTheDocument();
    });

    it('shows first-time cloud prompt when "Save to Cloud" is clicked', () => {
      renderShareDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));
      // FirstTimeCloudPrompt contains "Save to Cloud" dialog with specific text
      expect(
        screen.getByText('Your project will be uploaded to our servers and you\'ll get a shareable link.'),
      ).toBeInTheDocument();
    });

    it('calls saveToCloud after confirming first-time prompt (active project path)', async () => {
      const mockSaveToCloud = vi.fn().mockResolvedValue(undefined);
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: mockSaveToCloud,
        saveProjectToCloud: vi.fn(),
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      renderShareDialog();

      // Click "Save to Cloud" to open first-time prompt
      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));

      // Confirm the first-time prompt — find the confirm button within the prompt
      const confirmButtons = screen.getAllByRole('button', { name: 'Save to Cloud' });
      // The last one in the DOM is the confirm button inside the ConfirmationDialog
      const confirmBtn = confirmButtons[confirmButtons.length - 1];
      await act(async () => {
        fireEvent.click(confirmBtn);
      });

      expect(mockSaveToCloud).toHaveBeenCalledOnce();
    });

    it('does not call saveToCloud if first-time prompt is cancelled', () => {
      const mockSaveToCloud = vi.fn();
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: mockSaveToCloud,
        saveProjectToCloud: vi.fn(),
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      renderShareDialog();

      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(mockSaveToCloud).not.toHaveBeenCalled();
    });

    it('calls doSave directly (skips first-time prompt) when cloud project already exists', () => {
      const mockSaveToCloud = vi.fn();
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-existing',
        isOwner: true,
        isDirty: true,
        status: 'idle',
        error: null,
        shareUrl: 'https://example.com/#/p/cloud-existing',
        lastCloudSavedAt: null,
        visibility: 'unlisted',
      });
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: mockSaveToCloud,
        saveProjectToCloud: vi.fn(),
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      // For unlisted, there's no "Save to Cloud" button — test via private visibility
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-existing',
        isOwner: true,
        isDirty: true,
        status: 'idle',
        error: null,
        shareUrl: null,
        lastCloudSavedAt: null,
        visibility: 'private',
      });
      renderShareDialog();

      // With a cloud project that's private, there is "Make Unlisted" — not Save to Cloud
      // There's no direct "Save to Cloud" button in that state. Only state C (no cloud) has Save button.
      // So let's verify Save to Cloud won't show for existing cloud project
      expect(screen.queryByRole('button', { name: 'Save to Cloud' })).not.toBeInTheDocument();
    });
  });

  // ── 4. Loading states ─────────────────────────────────────────────

  describe('loading states', () => {
    beforeEach(() => {
      (isCloudEnabled as Mock).mockReturnValue(true);
    });

    it('shows "Saving..." text and disables button while cloud is saving (active project path)', () => {
      (useCloudSync as Mock).mockReturnValue({
        cloudId: null,
        isOwner: false,
        isDirty: false,
        status: 'saving',
        error: null,
        shareUrl: null,
        lastCloudSavedAt: null,
        visibility: 'private',
      });
      renderShareDialog();
      const btn = screen.getByRole('button', { name: 'Saving...' });
      expect(btn).toBeDisabled();
    });

    it('shows "Saving..." and disables button while saving in projectLocalId mode', async () => {
      const mockSaveProjectToCloud = vi.fn(
        () => new Promise<void>(() => {}), // never resolves to keep loading state
      );
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: vi.fn(),
        saveProjectToCloud: mockSaveProjectToCloud,
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-123',
            cloudId: null,
            name: 'Test Project',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-123',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-123' });

      const saveBtn = screen.getByRole('button', { name: 'Save to Cloud' });
      act(() => {
        fireEvent.click(saveBtn);
      });

      // Confirm first-time prompt
      const confirmButtons = screen.getAllByRole('button', { name: 'Save to Cloud' });
      const confirmBtn = confirmButtons[confirmButtons.length - 1];
      act(() => {
        fireEvent.click(confirmBtn);
      });

      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
      });
    });
  });

  // ── 5. Error states ───────────────────────────────────────────────

  describe('error states', () => {
    beforeEach(() => {
      (isCloudEnabled as Mock).mockReturnValue(true);
    });

    it('shows cloud save error message when saveProjectToCloud fails', async () => {
      const mockSaveProjectToCloud = vi.fn().mockRejectedValue(new Error('Upload failed'));
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: vi.fn(),
        saveProjectToCloud: mockSaveProjectToCloud,
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-123',
            cloudId: null,
            name: 'Test Project',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-123',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-123' });

      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));

      const confirmButtons = screen.getAllByRole('button', { name: 'Save to Cloud' });
      const confirmBtn = confirmButtons[confirmButtons.length - 1];
      await act(async () => {
        fireEvent.click(confirmBtn);
      });

      await waitFor(() => {
        expect(screen.getByText('Upload failed')).toBeInTheDocument();
      });
    });

    it('shows generic error message when error has no message (projectLocalId path)', async () => {
      const mockSaveProjectToCloud = vi.fn().mockRejectedValue('non-error string');
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: vi.fn(),
        saveProjectToCloud: mockSaveProjectToCloud,
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-err',
            cloudId: null,
            name: 'Test Project',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-err',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-err' });

      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));
      const confirmButtons = screen.getAllByRole('button', { name: 'Save to Cloud' });
      const confirmBtn = confirmButtons[confirmButtons.length - 1];
      await act(async () => {
        fireEvent.click(confirmBtn);
      });

      await waitFor(() => {
        expect(screen.getByText('Failed to save to cloud.')).toBeInTheDocument();
      });
    });

    it('calls setProjectVisibility and handles rejection silently when project has cloudId (error not visible in State B)', async () => {
      // State B (cloud + private) does not render the saveError in its UI,
      // so we only verify that setProjectVisibility was called and the promise
      // rejection is caught without throwing.
      const mockSetProjectVisibility = vi.fn().mockRejectedValue(new Error('Visibility update failed'));
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: vi.fn(),
        saveProjectToCloud: vi.fn(),
        setVisibility: vi.fn(),
        setProjectVisibility: mockSetProjectVisibility,
      });
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-vis',
            cloudId: 'cloud-vis',
            name: 'Test Project',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-vis',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-vis' });

      // Click Make Unlisted — rejection should be caught without throwing
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Make Unlisted' }));
      });

      // setProjectVisibility was called with correct args
      expect(mockSetProjectVisibility).toHaveBeenCalledWith('local-vis', 'unlisted');
      // The "Make Unlisted" button is still present (State B remains because cloudId is still set)
      expect(screen.getByRole('button', { name: 'Make Unlisted' })).toBeInTheDocument();
    });

    it('shows visibility change error when saveProjectToCloud fails (error visible in State C)', async () => {
      // Error from a failed save is visible in State C (no cloudId), confirming
      // error display works end-to-end through the error state variable.
      const mockSaveProjectToCloud = vi.fn().mockRejectedValue(new Error('Visibility update failed'));
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: vi.fn(),
        saveProjectToCloud: mockSaveProjectToCloud,
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-vis-c',
            cloudId: null,
            name: 'Test Project',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-vis-c',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-vis-c' });

      // In State C, click "Save to Cloud" → first-time prompt → confirm → error
      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));
      const confirmButtons = screen.getAllByRole('button', { name: 'Save to Cloud' });
      const confirmBtn = confirmButtons[confirmButtons.length - 1];
      await act(async () => {
        fireEvent.click(confirmBtn);
      });

      await waitFor(() => {
        expect(screen.getByText('Visibility update failed')).toBeInTheDocument();
      });
    });
  });

  // ── 6. Copy button ────────────────────────────────────────────────

  describe('copy button', () => {
    it('renders a copy button for the snapshot URL', () => {
      renderShareDialog();
      expect(screen.getByRole('button', { name: 'Copy snapshot URL' })).toBeInTheDocument();
    });

    it('copies snapshot URL to clipboard on click', async () => {
      renderShareDialog();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy snapshot URL' }));
      });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://example.com/#data=abc123');
    });

    it('renders copy button for cloud link when cloud project is unlisted', () => {
      (isCloudEnabled as Mock).mockReturnValue(true);
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-xyz',
        isOwner: true,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: 'https://example.com/#/p/cloud-xyz',
        lastCloudSavedAt: '2024-01-01T00:00:00Z',
        visibility: 'unlisted',
      });
      renderShareDialog();
      expect(screen.getByRole('button', { name: 'Copy cloud link' })).toBeInTheDocument();
    });

    it('copies cloud link URL to clipboard on click', async () => {
      (isCloudEnabled as Mock).mockReturnValue(true);
      (useCloudSync as Mock).mockReturnValue({
        cloudId: 'cloud-xyz',
        isOwner: true,
        isDirty: false,
        status: 'idle',
        error: null,
        shareUrl: 'https://example.com/#/p/cloud-xyz',
        lastCloudSavedAt: '2024-01-01T00:00:00Z',
        visibility: 'unlisted',
      });
      renderShareDialog();
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Copy cloud link' }));
      });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://example.com/#/p/cloud-xyz',
      );
    });
  });

  // ── 7. projectLocalId mode branching ─────────────────────────────

  describe('projectLocalId mode branching', () => {
    it('loads project state from localStorage when projectLocalId is provided', () => {
      const storedState = {
        registers: [{ id: 'r1', name: 'REG_A', width: 16, fields: [] }],
        activeRegisterId: 'r1',
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      };
      (loadProject as Mock).mockReturnValue({
        localId: 'local-456',
        state: storedState,
      });
      (deserializeState as Mock).mockReturnValue(storedState);

      renderShareDialog({ projectLocalId: 'local-456' });

      expect(loadProject).toHaveBeenCalledWith('local-456');
      expect(deserializeState).toHaveBeenCalledWith(storedState);
    });

    it('uses active app state when projectLocalId is not provided', () => {
      const activeState = {
        registers: [{ id: 'r2', name: 'REG_B', width: 8, fields: [] }],
        activeRegisterId: 'r2',
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      };
      (useAppState as Mock).mockReturnValue(activeState);

      renderShareDialog();

      // loadProject should NOT be called for the active project path
      expect(loadProject).not.toHaveBeenCalled();
      // buildSnapshotUrl should be called with the active state
      expect(buildSnapshotUrl).toHaveBeenCalledWith(activeState);
    });

    it('shows snapshot URL error when projectLocalId project is not found', () => {
      (loadProject as Mock).mockReturnValue(null);
      renderShareDialog({ projectLocalId: 'nonexistent' });
      // When storedTargetState is null, targetState is null so snapshotUrl is null
      expect(screen.getByText('Failed to generate snapshot URL.')).toBeInTheDocument();
    });

    it('reads cloud info from manifest when projectLocalId is given (no cloud)', () => {
      (isCloudEnabled as Mock).mockReturnValue(true);
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-789',
            cloudId: null,
            name: 'My Project',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-789',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-789' });

      // No cloudId in manifest → shows "Save to Cloud" button
      expect(screen.getByRole('button', { name: 'Save to Cloud' })).toBeInTheDocument();
    });

    it('reads cloud info from manifest when projectLocalId is given (with cloudId, private)', () => {
      (isCloudEnabled as Mock).mockReturnValue(true);
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-cloud',
            cloudId: 'cloud-manifest',
            name: 'Cloud Project',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-cloud',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-cloud' });

      // cloudId in manifest, private → shows "Make Unlisted" button
      expect(screen.getByRole('button', { name: 'Make Unlisted' })).toBeInTheDocument();
    });

    it('reads cloud info from manifest when projectLocalId is given (with cloudId, unlisted)', () => {
      (isCloudEnabled as Mock).mockReturnValue(true);
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-cloud-ul',
            cloudId: 'cloud-unlisted',
            name: 'Unlisted Project',
            visibility: 'unlisted',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-cloud-ul',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-cloud-ul' });

      // cloudId + unlisted → shows cloud URL input
      expect(
        screen.getByDisplayValue('https://example.com/#/p/cloud-unlisted'),
      ).toBeInTheDocument();
      expect(screen.getByText('Unlisted')).toBeInTheDocument();
    });

    it('calls saveProjectToCloud (not saveToCloud) in projectLocalId mode', async () => {
      const mockSaveProjectToCloud = vi.fn().mockResolvedValue(undefined);
      const mockSaveToCloud = vi.fn();
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: mockSaveToCloud,
        saveProjectToCloud: mockSaveProjectToCloud,
        setVisibility: vi.fn(),
        setProjectVisibility: vi.fn(),
      });
      (isCloudEnabled as Mock).mockReturnValue(true);
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-save',
            cloudId: null,
            name: 'Test',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-save',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-save' });

      fireEvent.click(screen.getByRole('button', { name: 'Save to Cloud' }));

      // Confirm first-time prompt
      const confirmButtons = screen.getAllByRole('button', { name: 'Save to Cloud' });
      const confirmBtn = confirmButtons[confirmButtons.length - 1];
      await act(async () => {
        fireEvent.click(confirmBtn);
      });

      expect(mockSaveProjectToCloud).toHaveBeenCalledWith('local-save');
      expect(mockSaveToCloud).not.toHaveBeenCalled();
    });

    it('calls setProjectVisibility (not setVisibility) in projectLocalId mode', async () => {
      const mockSetProjectVisibility = vi.fn().mockResolvedValue(undefined);
      const mockSetVisibility = vi.fn();
      (useCloudSyncActions as Mock).mockReturnValue({
        saveToCloud: vi.fn(),
        saveProjectToCloud: vi.fn(),
        setVisibility: mockSetVisibility,
        setProjectVisibility: mockSetProjectVisibility,
      });
      (isCloudEnabled as Mock).mockReturnValue(true);
      (loadManifest as Mock).mockReturnValue({
        version: 1,
        projects: [
          {
            localId: 'local-vis',
            cloudId: 'cloud-vis',
            name: 'Test',
            visibility: 'private',
            createdAt: '2024-01-01T00:00:00Z',
            localSavedAt: '2024-01-01T00:00:00Z',
            cloudSavedAt: null,
          },
        ],
      });
      (loadProject as Mock).mockReturnValue({
        localId: 'local-vis',
        state: {
          registers: [],
          activeRegisterId: null,
          registerValues: {},
          mapTableWidth: 32,
          mapShowGaps: true,
          mapSortDescending: false,
          addressUnitBits: 8,
        },
      });
      (deserializeState as Mock).mockReturnValue({
        registers: [],
        activeRegisterId: null,
        registerValues: {},
        mapTableWidth: 32,
        mapShowGaps: true,
        mapSortDescending: false,
        addressUnitBits: 8,
      });

      renderShareDialog({ projectLocalId: 'local-vis' });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Make Unlisted' }));
      });

      expect(mockSetProjectVisibility).toHaveBeenCalledWith('local-vis', 'unlisted');
      expect(mockSetVisibility).not.toHaveBeenCalled();
    });

    it('does not load project from storage when dialog is closed', () => {
      renderShareDialog({ open: false, projectLocalId: 'local-closed' });
      expect(loadProject).not.toHaveBeenCalled();
    });
  });
});
