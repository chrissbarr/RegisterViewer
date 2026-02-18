import { render, screen, fireEvent } from '@testing-library/react';
import { ImportResultDialog } from './import-result-dialog';
import type { ImportWarning } from '../../utils/storage';

beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
});

const sampleWarnings: ImportWarning[] = [
  {
    registerIndex: 0,
    registerName: 'TCCR0A',
    errors: [{ message: 'Register width must be between 1 and 128 (got 256)' }],
  },
  {
    registerIndex: 3,
    registerName: 'BAD_REG',
    errors: [
      { message: 'MSB (7) must be >= LSB (8)' },
      { message: 'Flag field must be 1 bit wide (got 2)' },
    ],
  },
];

function renderWarningDialog(onClose = vi.fn()) {
  return { onClose, ...render(
    <ImportResultDialog
      open={true}
      onClose={onClose}
      variant="warning"
      importedCount={6}
      skippedCount={2}
      warnings={sampleWarnings}
    />,
  ) };
}

function renderErrorDialog(onClose = vi.fn(), errorMessage?: string) {
  return { onClose, ...render(
    <ImportResultDialog
      open={true}
      onClose={onClose}
      variant="error"
      importedCount={0}
      skippedCount={0}
      warnings={[]}
      errorMessage={errorMessage}
    />,
  ) };
}

describe('ImportResultDialog', () => {
  describe('warning variant', () => {
    it('renders the warning title', () => {
      renderWarningDialog();
      expect(screen.getByRole('heading', { name: 'Import Completed with Warnings' })).toBeInTheDocument();
    });

    it('shows imported and skipped counts', () => {
      renderWarningDialog();
      expect(screen.getByText(/6 registers imported successfully/)).toBeInTheDocument();
      expect(screen.getByText(/2 skipped due to validation errors/)).toBeInTheDocument();
    });

    it('renders each warning with register name and error messages', () => {
      renderWarningDialog();
      expect(screen.getByText('TCCR0A')).toBeInTheDocument();
      expect(screen.getByText('Register width must be between 1 and 128 (got 256)')).toBeInTheDocument();
      expect(screen.getByText('BAD_REG')).toBeInTheDocument();
      expect(screen.getByText('MSB (7) must be >= LSB (8)')).toBeInTheDocument();
      expect(screen.getByText('Flag field must be 1 bit wide (got 2)')).toBeInTheDocument();
    });

    it('renders "Got it" button that calls onClose', () => {
      const { onClose } = renderWarningDialog();
      const button = screen.getByRole('button', { name: 'Got it' });
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(onClose).toHaveBeenCalledOnce();
    });

    it('uses singular "register" for importedCount of 1', () => {
      render(
        <ImportResultDialog
          open={true}
          onClose={vi.fn()}
          variant="warning"
          importedCount={1}
          skippedCount={1}
          warnings={[sampleWarnings[0]]}
        />,
      );
      expect(screen.getByText(/1 register imported successfully/)).toBeInTheDocument();
    });
  });

  describe('error variant', () => {
    it('renders the error title', () => {
      renderErrorDialog();
      expect(screen.getByRole('heading', { name: 'Import Failed' })).toBeInTheDocument();
    });

    it('shows default error message when none provided', () => {
      renderErrorDialog();
      expect(screen.getByText('Failed to import: invalid JSON or missing registers array.')).toBeInTheDocument();
    });

    it('shows custom error message when provided', () => {
      renderErrorDialog(vi.fn(), 'Custom error occurred.');
      expect(screen.getByText('Custom error occurred.')).toBeInTheDocument();
    });

    it('does not render warning list', () => {
      renderErrorDialog();
      expect(screen.queryByText('TCCR0A')).not.toBeInTheDocument();
    });

    it('renders "Got it" button that calls onClose', () => {
      const { onClose } = renderErrorDialog();
      fireEvent.click(screen.getByRole('button', { name: 'Got it' }));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });

  describe('closed state', () => {
    it('does not render content when closed', () => {
      render(
        <ImportResultDialog
          open={false}
          onClose={vi.fn()}
          variant="warning"
          importedCount={0}
          skippedCount={0}
          warnings={[]}
        />,
      );
      expect(screen.queryByRole('heading', { name: 'Import Completed with Warnings' })).not.toBeInTheDocument();
    });
  });
});
