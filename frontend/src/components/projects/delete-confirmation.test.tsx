import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DeleteConfirmation } from './delete-confirmation';

describe('DeleteConfirmation', () => {
  it('shows cloud warning when isCloud is true', () => {
    render(
      <DeleteConfirmation
        projectName="Test"
        isCloud={true}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/shared links will stop working/i),
    ).toBeInTheDocument();
  });

  it('does not show cloud warning when isCloud is false', () => {
    render(
      <DeleteConfirmation
        projectName="Test"
        isCloud={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.queryByText(/shared links will stop working/i),
    ).not.toBeInTheDocument();
  });

  it('renders Delete and Cancel buttons', () => {
    render(
      <DeleteConfirmation
        projectName="My Project"
        isCloud={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /delete project my project/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /cancel deletion/i }),
    ).toBeInTheDocument();
  });

  it('shows "Delete this project?" prompt', () => {
    render(
      <DeleteConfirmation
        projectName="Test"
        isCloud={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Delete this project?')).toBeInTheDocument();
  });
});
