import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmationDialog } from './confirmation-dialog';

describe('ConfirmationDialog', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    title: 'Confirm Action',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders title and description', () => {
    render(
      <ConfirmationDialog {...defaultProps} description="Are you sure?" />,
    );

    expect(screen.getByText('Confirm Action')).toBeInTheDocument();
    expect(screen.getByText('Are you sure?')).toBeInTheDocument();
  });

  it('renders custom button labels', () => {
    render(
      <ConfirmationDialog
        {...defaultProps}
        confirmLabel="Delete"
        cancelLabel="Keep"
      />,
    );

    expect(screen.getByText('Delete')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
  });

  it('renders children content', () => {
    render(
      <ConfirmationDialog {...defaultProps}>
        <p>Custom content</p>
      </ConfirmationDialog>,
    );

    expect(screen.getByText('Custom content')).toBeInTheDocument();
  });

  it('calls onConfirm and onClose when confirm is clicked', () => {
    render(<ConfirmationDialog {...defaultProps} confirmLabel="OK" />);

    fireEvent.click(screen.getByText('OK'));

    expect(defaultProps.onConfirm).toHaveBeenCalledOnce();
    expect(defaultProps.onClose).toHaveBeenCalledOnce();
  });

  it('calls onClose when cancel is clicked', () => {
    render(<ConfirmationDialog {...defaultProps} />);

    fireEvent.click(screen.getByText('Cancel'));

    expect(defaultProps.onClose).toHaveBeenCalledOnce();
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it('uses alertdialog role', () => {
    const { container } = render(<ConfirmationDialog {...defaultProps} />);

    const dialog = container.querySelector('dialog');
    expect(dialog).toHaveAttribute('role', 'alertdialog');
  });

  it('links description via aria-describedby', () => {
    const { container } = render(
      <ConfirmationDialog {...defaultProps} description="This is dangerous" />,
    );

    const dialog = container.querySelector('dialog');
    const describedBy = dialog?.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();

    const descriptionEl = document.getElementById(describedBy!);
    expect(descriptionEl).toHaveTextContent('This is dangerous');
  });

  it('omits aria-describedby when no description', () => {
    const { container } = render(<ConfirmationDialog {...defaultProps} />);

    const dialog = container.querySelector('dialog');
    expect(dialog?.getAttribute('aria-describedby')).toBeNull();
  });

  it('applies destructive button styling for destructive variant', () => {
    render(
      <ConfirmationDialog {...defaultProps} variant="destructive" confirmLabel="Delete" />,
    );

    const deleteBtn = screen.getByText('Delete');
    expect(deleteBtn.className).toContain('bg-red-600');
  });

  it('applies primary button styling by default', () => {
    render(<ConfirmationDialog {...defaultProps} confirmLabel="Save" />);

    const saveBtn = screen.getByText('Save');
    expect(saveBtn.className).toContain('bg-blue-600');
  });

  it('does not render content when closed', () => {
    render(
      <ConfirmationDialog {...defaultProps} open={false} description="Hidden" />,
    );

    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
  });
});
