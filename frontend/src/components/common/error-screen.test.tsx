import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ErrorScreen } from './error-screen';

describe('ErrorScreen', () => {
  it('renders the pinned heading and the provided message', () => {
    render(<ErrorScreen message="Boom happened." />);
    // Pin the copy shared with AppLoader's error path and the boundary fallback.
    expect(screen.getByText('Unable to load project')).toBeInTheDocument();
    expect(screen.getByText('Boom happened.')).toBeInTheDocument();
  });

  it('renders the optional action node', () => {
    render(<ErrorScreen message="msg" action={<button>Do thing</button>} />);
    expect(screen.getByRole('button', { name: 'Do thing' })).toBeInTheDocument();
  });

  it('renders no action when none is provided', () => {
    render(<ErrorScreen message="msg" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
