import { useEffect, useRef } from 'react';
import { render, screen, act } from '@testing-library/react';
import { ToastPortalProvider, useToastPortalTarget, useToastPortalRegister } from './toast-portal-context';

// jsdom doesn't implement the Popover API
beforeEach(() => {
  HTMLElement.prototype.showPopover ??= vi.fn();
  HTMLElement.prototype.hidePopover ??= vi.fn();
});

// Helper that exposes context values via data attributes
function Inspector() {
  const target = useToastPortalTarget();
  return <div data-testid="inspector" data-has-target={target !== null} />;
}

// Helper that registers via useEffect (like the real Dialog does)
function DialogStub({ open, onUnregister }: { open: boolean; onUnregister?: (fn: () => void) => void }) {
  const register = useToastPortalRegister();
  const unregisterRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) return;
    const cleanup = register();
    unregisterRef.current = cleanup;
    onUnregister?.(cleanup);
    return cleanup;
  }, [open, register, onUnregister]);

  return null;
}

describe('ToastPortalProvider', () => {
  it('provides null target when no dialog is registered', () => {
    render(
      <ToastPortalProvider>
        <Inspector />
      </ToastPortalProvider>,
    );
    expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'false');
  });

  it('provides a target after a dialog registers', async () => {
    render(
      <ToastPortalProvider>
        <Inspector />
        <DialogStub open={true} />
      </ToastPortalProvider>,
    );

    // Target is set asynchronously via queueMicrotask
    await act(() => Promise.resolve());

    expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'true');
  });

  it('clears target when the last dialog unregisters', async () => {
    const { rerender } = render(
      <ToastPortalProvider>
        <Inspector />
        <DialogStub open={true} />
      </ToastPortalProvider>,
    );

    await act(() => Promise.resolve());
    expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'true');

    // Close the dialog — effect cleanup runs, target should clear
    rerender(
      <ToastPortalProvider>
        <Inspector />
        <DialogStub open={false} />
      </ToastPortalProvider>,
    );

    expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'false');
  });

  it('keeps target while at least one dialog is still open (depth tracking)', async () => {
    const { rerender } = render(
      <ToastPortalProvider>
        <Inspector />
        <DialogStub open={true} />
        <DialogStub open={true} />
      </ToastPortalProvider>,
    );

    await act(() => Promise.resolve());
    expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'true');

    // Close one dialog — target should remain
    rerender(
      <ToastPortalProvider>
        <Inspector />
        <DialogStub open={false} />
        <DialogStub open={true} />
      </ToastPortalProvider>,
    );

    // Need to flush microtask from the still-open dialog's re-registration
    await act(() => Promise.resolve());
    expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'true');

    // Close the second — target should clear
    rerender(
      <ToastPortalProvider>
        <Inspector />
        <DialogStub open={false} />
        <DialogStub open={false} />
      </ToastPortalProvider>,
    );

    expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'false');
  });

  it('calls showPopover and hidePopover at the right times', async () => {
    const showSpy = vi.spyOn(HTMLElement.prototype, 'showPopover');
    const hideSpy = vi.spyOn(HTMLElement.prototype, 'hidePopover');

    const { rerender } = render(
      <ToastPortalProvider>
        <DialogStub open={true} />
      </ToastPortalProvider>,
    );

    await act(() => Promise.resolve());
    expect(showSpy).toHaveBeenCalled();

    hideSpy.mockClear();

    rerender(
      <ToastPortalProvider>
        <DialogStub open={false} />
      </ToastPortalProvider>,
    );

    expect(hideSpy).toHaveBeenCalledOnce();

    showSpy.mockRestore();
    hideSpy.mockRestore();
  });

  describe('without provider (default context)', () => {
    it('returns null target', () => {
      render(<Inspector />);
      expect(screen.getByTestId('inspector')).toHaveAttribute('data-has-target', 'false');
    });

    it('register returns a no-op cleanup', () => {
      function RegisterTest() {
        const register = useToastPortalRegister();
        const cleanup = register();
        cleanup(); // Should not throw
        return <div data-testid="ok" />;
      }
      render(<RegisterTest />);
      expect(screen.getByTestId('ok')).toBeInTheDocument();
    });
  });
});
