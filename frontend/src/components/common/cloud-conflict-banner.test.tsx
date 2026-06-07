import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CloudConflictBanner } from './cloud-conflict-banner';

describe('CloudConflictBanner', () => {
  it('renders conflict recovery actions', () => {
    render(
      <CloudConflictBanner
        serverVersion={7}
        onKeepLocalVersion={vi.fn()}
        onLoadServerVersion={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('version 7');
    expect(screen.getByRole('button', { name: /Keep local/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Load server/i })).toBeInTheDocument();
  });

  it('runs the keep-local action', async () => {
    const onKeepLocalVersion = vi.fn(() => Promise.resolve(true));
    render(
      <CloudConflictBanner
        serverVersion={7}
        onKeepLocalVersion={onKeepLocalVersion}
        onLoadServerVersion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Keep local/i }));

    await waitFor(() => {
      expect(onKeepLocalVersion).toHaveBeenCalledTimes(1);
    });
  });

  it('runs the load-server action', async () => {
    const onLoadServerVersion = vi.fn(() => Promise.resolve());
    render(
      <CloudConflictBanner
        serverVersion={7}
        onKeepLocalVersion={vi.fn()}
        onLoadServerVersion={onLoadServerVersion}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Load server/i }));

    await waitFor(() => {
      expect(onLoadServerVersion).toHaveBeenCalledTimes(1);
    });
  });

  it('shows inline error text when onKeepLocalVersion rejects', async () => {
    const onKeepLocalVersion = vi.fn(() => Promise.reject(new Error('Could not save your changes. Please try again.')));
    render(
      <CloudConflictBanner
        serverVersion={7}
        onKeepLocalVersion={onKeepLocalVersion}
        onLoadServerVersion={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Keep local/i }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Could not save your changes. Please try again.');
    });
  });
});
