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

  describe('load behavior', () => {
    it('clicking an example calls onLoad with data and name', () => {
      const { onLoad } = renderExamplesDialog();
      fireEvent.click(screen.getByText(examples[0].name));
      expect(onLoad).toHaveBeenCalledOnce();
      expect(onLoad).toHaveBeenCalledWith(examples[0].data, examples[0].name);
    });

    it('each example button triggers onLoad with correct data', () => {
      const { onLoad } = renderExamplesDialog();
      for (const example of examples) {
        onLoad.mockClear();
        fireEvent.click(screen.getByText(example.name));
        expect(onLoad).toHaveBeenCalledWith(example.data, example.name);
      }
    });
  });
});
