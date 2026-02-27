import { render, screen, fireEvent } from '@testing-library/react';
import { ExamplesDialog } from './examples-dialog';
import { examples } from '../../data/examples';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});

function renderExamplesDialog(open = true, onLoad = vi.fn(), onClose = vi.fn()) {
  return { onLoad, onClose, ...render(
    <ExamplesDialog open={open} onClose={onClose} onLoad={onLoad} />,
  ) };
}

describe('ExamplesDialog', () => {
  describe('rendering', () => {
    it('renders all example cards when open', () => {
      renderExamplesDialog();
      for (const example of examples) {
        expect(screen.getByText(example.name)).toBeInTheDocument();
      }
    });

    it('shows register count for each example', () => {
      renderExamplesDialog();
      const counts = examples.map(e => e.registerCount);
      const uniqueCounts = new Set(counts);
      for (const count of uniqueCounts) {
        const expected = counts.filter(c => c === count).length;
        expect(screen.getAllByText(`${count} registers`)).toHaveLength(expected);
      }
    });

    it('shows description for each example', () => {
      renderExamplesDialog();
      for (const example of examples) {
        expect(screen.getByText(example.description)).toBeInTheDocument();
      }
    });
  });

  describe('confirmation flow', () => {
    it('clicking an example shows confirmation', () => {
      renderExamplesDialog();
      fireEvent.click(screen.getByText(examples[0].name));
      expect(screen.getByText(/Replace current registers with/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('clicking Cancel returns to list', () => {
      renderExamplesDialog();
      fireEvent.click(screen.getByText(examples[0].name));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      // Confirmation gone, example card is back as a button
      expect(screen.queryByText(/Replace current registers with/)).not.toBeInTheDocument();
      expect(screen.getByText(examples[0].name)).toBeInTheDocument();
    });

    it('clicking Load calls onLoad with JSON data and closes', () => {
      const { onLoad, onClose } = renderExamplesDialog();
      fireEvent.click(screen.getByText(examples[0].name));
      fireEvent.click(screen.getByRole('button', { name: 'Load' }));
      expect(onLoad).toHaveBeenCalledOnce();
      expect(onLoad).toHaveBeenCalledWith(examples[0].data);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('only one example can be in confirming state at a time', () => {
      renderExamplesDialog();
      fireEvent.click(screen.getByText(examples[0].name));
      expect(screen.getByText(/Replace current registers with/)).toBeInTheDocument();
      // Click a different example
      fireEvent.click(screen.getByText(examples[1].name));
      // Only one confirmation visible
      const confirmations = screen.getAllByText(/Replace current registers with/);
      expect(confirmations).toHaveLength(1);
      expect(confirmations[0].textContent).toContain(examples[1].name);
    });
  });

  describe('close behavior', () => {
    it('resets confirmation state when dialog closes and reopens', () => {
      const { rerender, onLoad, onClose } = renderExamplesDialog();
      // Start confirmation
      fireEvent.click(screen.getByText(examples[0].name));
      expect(screen.getByText(/Replace current registers with/)).toBeInTheDocument();
      // Close and reopen
      rerender(<ExamplesDialog open={false} onClose={onClose} onLoad={onLoad} />);
      rerender(<ExamplesDialog open={true} onClose={onClose} onLoad={onLoad} />);
      // Confirmation should be gone
      expect(screen.queryByText(/Replace current registers with/)).not.toBeInTheDocument();
    });
  });
});
