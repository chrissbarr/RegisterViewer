import { render, screen, act } from '@testing-library/react';
import { Toast } from './toast';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Toast', () => {
  describe('rendering', () => {
    it('renders the message', () => {
      render(<Toast message="Import successful" onDismiss={vi.fn()} />);
      expect(screen.getByText('Import successful')).toBeInTheDocument();
    });

    it('has role="status" and aria-live="polite" for accessibility', () => {
      render(<Toast message="Done" onDismiss={vi.fn()} />);
      const container = screen.getByRole('status');
      expect(container).toHaveAttribute('aria-live', 'polite');
    });

    it('renders into document.body via portal (fallback when no ToastPortalProvider)', () => {
      const { baseElement } = render(<Toast message="Portal test" onDismiss={vi.fn()} />);
      // Without a provider, the toast falls back to document.body
      const status = baseElement.ownerDocument.body.querySelector('[role="status"]');
      expect(status).toBeInTheDocument();
    });
  });

  describe('auto-dismiss', () => {
    it('calls onDismiss after duration', () => {
      const onDismiss = vi.fn();
      render(<Toast message="Bye" duration={3000} onDismiss={onDismiss} />);

      // Not yet dismissed at 2999ms
      act(() => { vi.advanceTimersByTime(2999); });
      expect(onDismiss).not.toHaveBeenCalled();

      // Timer fires at 3000ms, calls onDismiss directly
      act(() => { vi.advanceTimersByTime(1); });
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('uses custom duration', () => {
      const onDismiss = vi.fn();
      render(<Toast message="Quick" duration={1000} onDismiss={onDismiss} />);

      act(() => { vi.advanceTimersByTime(999); });
      expect(onDismiss).not.toHaveBeenCalled();

      act(() => { vi.advanceTimersByTime(1); });
      expect(onDismiss).toHaveBeenCalledOnce();
    });

    it('cleans up timers on unmount before dismiss fires', () => {
      const onDismiss = vi.fn();
      const { unmount } = render(<Toast message="Early unmount" duration={3000} onDismiss={onDismiss} />);

      act(() => { vi.advanceTimersByTime(1000); });
      unmount();

      // Advance past when dismiss would have fired
      act(() => { vi.advanceTimersByTime(5000); });
      expect(onDismiss).not.toHaveBeenCalled();
    });

    it('calls onDismiss exactly once after duration', () => {
      const onDismiss = vi.fn();
      render(<Toast message="Once only" duration={3000} onDismiss={onDismiss} />);

      act(() => { vi.advanceTimersByTime(3000); });
      expect(onDismiss).toHaveBeenCalledOnce();

      // No additional calls after more time
      act(() => { vi.advanceTimersByTime(5000); });
      expect(onDismiss).toHaveBeenCalledOnce();
    });
  });

  describe('variants', () => {
    it('defaults to success variant', () => {
      render(<Toast message="Success" onDismiss={vi.fn()} />);
      // Success variant uses green accent
      const accent = screen.getByRole('status').querySelector('.bg-green-500');
      expect(accent).toBeInTheDocument();
    });

    it('renders info variant with blue accent', () => {
      render(<Toast message="Info" variant="info" onDismiss={vi.fn()} />);
      const accent = screen.getByRole('status').querySelector('.bg-blue-500');
      expect(accent).toBeInTheDocument();
    });
  });
});
