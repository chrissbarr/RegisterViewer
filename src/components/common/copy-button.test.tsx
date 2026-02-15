import { render, screen, fireEvent, act } from '@testing-library/react';
import { CopyButton } from './copy-button';

describe('CopyButton', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a button with the given aria-label', () => {
    render(<CopyButton value="0xFF" label="Copy hex value" />);
    expect(screen.getByRole('button', { name: 'Copy hex value' })).toBeInTheDocument();
  });

  it('copies the value to clipboard on click', async () => {
    render(<CopyButton value="0xDEADBEEF" label="Copy hex" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy hex' }));
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('0xDEADBEEF');
  });

  it('shows checkmark icon after copying', async () => {
    const { container } = render(<CopyButton value="42" label="Copy dec" />);

    // Before click: clipboard icon (has <rect> element)
    expect(container.querySelector('rect')).toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy dec' }));
    });

    // After click: checkmark icon (has <polyline> element, no <rect>)
    expect(container.querySelector('polyline')).toBeInTheDocument();
    expect(container.querySelector('rect')).not.toBeInTheDocument();
  });

  it('reverts to clipboard icon after 1500ms', async () => {
    const { container } = render(<CopyButton value="0b101" label="Copy bin" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy bin' }));
    });

    // Checkmark visible
    expect(container.querySelector('polyline')).toBeInTheDocument();

    // Advance past the timeout
    act(() => {
      vi.advanceTimersByTime(1500);
    });

    // Back to clipboard icon
    expect(container.querySelector('rect')).toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeInTheDocument();
  });

  it('does not throw when clipboard API fails', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    const { container } = render(<CopyButton value="test" label="Copy" />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    // Should not show checkmark (copy failed)
    expect(container.querySelector('rect')).toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeInTheDocument();
  });
});
