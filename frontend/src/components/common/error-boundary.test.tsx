import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ErrorBoundary } from './error-boundary';

function ThrowInRender(): never {
  throw new Error('boom');
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ErrorBoundary', () => {
  it('renders the fallback and hides children when a child throws in render', () => {
    // React logs the caught error to console.error; suppress for a clean run.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowInRender />
        <div data-testid="child">child content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Unable to load project')).toBeInTheDocument();
    expect(screen.queryByTestId('child')).not.toBeInTheDocument();
  });

  it('renders children unchanged when nothing throws', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">child content</div>
      </ErrorBoundary>,
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.queryByText('Unable to load project')).not.toBeInTheDocument();
  });
});
