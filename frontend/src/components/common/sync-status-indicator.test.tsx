import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SyncStatusIndicator } from './sync-status-indicator';

describe('SyncStatusIndicator', () => {
  it('renders nothing when local-only', () => {
    const { container } = render(<SyncStatusIndicator status="local-only" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows checkmark when saved', () => {
    render(<SyncStatusIndicator status="saved" />);
    expect(screen.getByTitle('Saved to cloud')).toBeInTheDocument();
  });

  it('shows spinner when syncing', () => {
    render(<SyncStatusIndicator status="syncing" />);
    expect(screen.getByTitle('Saving to cloud...')).toBeInTheDocument();
  });

  it('shows warning when offline', () => {
    render(<SyncStatusIndicator status="offline" />);
    expect(screen.getByTitle(/changes saved locally/i)).toBeInTheDocument();
  });
});
