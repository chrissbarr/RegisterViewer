import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from './dialog';

// jsdom doesn't implement HTMLDialogElement.showModal/close
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});

function renderDialog(open = true, onClose = vi.fn()) {
  return { onClose, ...render(
    <Dialog open={open} onClose={onClose} title="Test Dialog">
      <p>Body content</p>
    </Dialog>,
  ) };
}

describe('Dialog', () => {
  describe('rendering', () => {
    it('renders title and children when open', () => {
      renderDialog(true);
      expect(screen.getByRole('heading', { name: 'Test Dialog' })).toBeInTheDocument();
      expect(screen.getByText('Body content')).toBeInTheDocument();
    });

    it('does not render children when closed', () => {
      renderDialog(false);
      expect(screen.queryByText('Body content')).not.toBeInTheDocument();
    });

    it('has aria-labelledby linking title', () => {
      renderDialog(true);
      const dialog = screen.getByRole('dialog');
      const titleId = screen.getByRole('heading', { name: 'Test Dialog' }).id;
      expect(dialog).toHaveAttribute('aria-labelledby', titleId);
    });
  });

  describe('closing', () => {
    it('calls onClose when close button is clicked', () => {
      const { onClose } = renderDialog(true);
      fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when backdrop (dialog element) is clicked', () => {
      const { onClose } = renderDialog(true);
      const dialog = screen.getByRole('dialog');
      fireEvent.click(dialog);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('does not call onClose when dialog content is clicked', () => {
      const { onClose } = renderDialog(true);
      fireEvent.click(screen.getByText('Body content'));
      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('open/close lifecycle', () => {
    it('calls showModal when open transitions to true', () => {
      const { rerender } = render(
        <Dialog open={false} onClose={vi.fn()} title="Test">content</Dialog>,
      );
      const showModalSpy = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
      rerender(
        <Dialog open={true} onClose={vi.fn()} title="Test">content</Dialog>,
      );
      expect(showModalSpy).toHaveBeenCalled();
      showModalSpy.mockRestore();
    });

    it('calls close when open transitions to false', () => {
      const { rerender } = render(
        <Dialog open={true} onClose={vi.fn()} title="Test">content</Dialog>,
      );
      const closeSpy = vi.spyOn(HTMLDialogElement.prototype, 'close');
      rerender(
        <Dialog open={false} onClose={vi.fn()} title="Test">content</Dialog>,
      );
      expect(closeSpy).toHaveBeenCalled();
      closeSpy.mockRestore();
    });
  });
});
