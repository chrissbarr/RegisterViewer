import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LoginDialog } from './login-dialog';
import { ApiError } from '../../utils/api-client';

// ── Mocks ────────────────────────────────────────────────────────────

const mockSendCode = vi.fn();
const mockVerifyCode = vi.fn();

vi.mock('../../context/auth-context', () => ({
  useAuthActions: vi.fn(() => ({
    sendCode: mockSendCode,
    verifyCode: mockVerifyCode,
    logout: vi.fn(),
    getJwt: vi.fn(() => null),
  })),
}));

// jsdom doesn't implement HTMLDialogElement.showModal/close
beforeEach(() => {
  HTMLDialogElement.prototype.showModal ??= vi.fn(function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close ??= vi.fn(function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  });
  vi.clearAllMocks();
});

function renderDialog(onClose = vi.fn()) {
  return { onClose, ...render(<LoginDialog open={true} onClose={onClose} />) };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('LoginDialog', () => {
  describe('email step', () => {
    it('renders email input and send button initially', () => {
      renderDialog();

      expect(screen.getByRole('heading', { name: 'Sign In' })).toBeInTheDocument();
      expect(screen.getByLabelText('Email address')).toBeInTheDocument();
      expect(screen.getByText('Send code')).toBeInTheDocument();
    });

    it('shows validation error for invalid email', async () => {
      renderDialog();

      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'not-an-email' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.');
      expect(mockSendCode).not.toHaveBeenCalled();
    });

    it('rejects email without valid TLD (stricter than old regex)', async () => {
      renderDialog();

      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@localhost' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.');
      expect(mockSendCode).not.toHaveBeenCalled();
    });

    it('shows validation error for empty email', async () => {
      renderDialog();

      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Please enter a valid email address.');
    });

    it('transitions to code step on successful send', async () => {
      mockSendCode.mockResolvedValue(undefined);
      renderDialog();

      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      await waitFor(() => {
        expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
      });

      expect(mockSendCode).toHaveBeenCalledWith('user@example.com');
      expect(screen.getByText('Verify')).toBeInTheDocument();
    });

    it('shows rate limit error on 429', async () => {
      mockSendCode.mockRejectedValue(new ApiError(429, { error: 'Too many requests' }));
      renderDialog();

      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a few minutes.');
    });

    it('shows service unavailable error on 503', async () => {
      mockSendCode.mockRejectedValue(new ApiError(503, { error: 'Service temporarily unavailable' }));
      renderDialog();

      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Service temporarily unavailable. Please try again later.');
    });

    it('shows generic error on other API failures', async () => {
      mockSendCode.mockRejectedValue(new Error('Network error'));
      renderDialog();

      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Failed to send code. Please try again.');
    });
  });

  describe('code step', () => {
    async function goToCodeStep() {
      mockSendCode.mockResolvedValue(undefined);
      const result = renderDialog();

      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);

      await waitFor(() => {
        expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
      });

      return result;
    }

    it('shows the email that was used', async () => {
      await goToCodeStep();

      expect(screen.getByText('user@example.com')).toBeInTheDocument();
    });

    it('shows validation error for non-6-digit code', async () => {
      await goToCodeStep();

      fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123' } });
      fireEvent.submit(screen.getByText('Verify').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Please enter the 6-digit code from your email.');
      expect(mockVerifyCode).not.toHaveBeenCalled();
    });

    it('calls verifyCode and closes on success', async () => {
      mockVerifyCode.mockResolvedValue(undefined);
      const { onClose } = await goToCodeStep();

      fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
      fireEvent.submit(screen.getByText('Verify').closest('form')!);

      await waitFor(() => {
        expect(mockVerifyCode).toHaveBeenCalledWith('user@example.com', '123456');
      });

      expect(onClose).toHaveBeenCalled();
    });

    it('shows error on invalid code (401)', async () => {
      mockVerifyCode.mockRejectedValue(new ApiError(401, { error: 'Invalid code' }));
      await goToCodeStep();

      fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '000000' } });
      fireEvent.submit(screen.getByText('Verify').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Invalid or expired code. Please try again.');
    });

    it('shows rate limit error on verify 429', async () => {
      mockVerifyCode.mockRejectedValue(new ApiError(429, { error: 'Too many verification attempts' }));
      await goToCodeStep();

      fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
      fireEvent.submit(screen.getByText('Verify').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a few minutes.');
    });

    it('shows service unavailable error on verify 503', async () => {
      mockVerifyCode.mockRejectedValue(new ApiError(503, { error: 'Service temporarily unavailable' }));
      await goToCodeStep();

      fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
      fireEvent.submit(screen.getByText('Verify').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Service temporarily unavailable. Please try again later.');
    });

    it('shows generic error on other verification failures', async () => {
      mockVerifyCode.mockRejectedValue(new Error('Server error'));
      await goToCodeStep();

      fireEvent.change(screen.getByLabelText('Verification code'), { target: { value: '123456' } });
      fireEvent.submit(screen.getByText('Verify').closest('form')!);

      expect(await screen.findByRole('alert')).toHaveTextContent('Verification failed. Please try again.');
    });

    it('"Change email" returns to email step', async () => {
      await goToCodeStep();

      fireEvent.click(screen.getByText('Change email'));

      expect(screen.getByLabelText('Email address')).toBeInTheDocument();
      expect(screen.getByText('Send code')).toBeInTheDocument();
    });

    it('"Resend code" calls sendCode again', async () => {
      await goToCodeStep();
      mockSendCode.mockClear();
      mockSendCode.mockResolvedValue(undefined);

      fireEvent.click(screen.getByText('Resend code'));

      await waitFor(() => {
        expect(mockSendCode).toHaveBeenCalledWith('user@example.com');
      });
    });

    it('"Resend code" shows rate limit error on 429', async () => {
      await goToCodeStep();
      mockSendCode.mockClear();
      mockSendCode.mockRejectedValue(new ApiError(429, { error: 'Too many requests' }));

      fireEvent.click(screen.getByText('Resend code'));

      expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts. Please wait a few minutes.');
    });

    it('"Resend code" shows service unavailable error on 503', async () => {
      await goToCodeStep();
      mockSendCode.mockClear();
      mockSendCode.mockRejectedValue(new ApiError(503, { error: 'Service temporarily unavailable' }));

      fireEvent.click(screen.getByText('Resend code'));

      expect(await screen.findByRole('alert')).toHaveTextContent('Service temporarily unavailable. Please try again later.');
    });
  });

  describe('dialog lifecycle', () => {
    it('does not render content when closed', () => {
      render(<LoginDialog open={false} onClose={vi.fn()} />);

      expect(screen.queryByText('Sign In')).not.toBeInTheDocument();
    });

    it('resets state when dialog is closed via close button', async () => {
      mockSendCode.mockResolvedValue(undefined);
      const onClose = vi.fn();
      render(<LoginDialog open={true} onClose={onClose} />);

      // Navigate to code step
      fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'user@example.com' } });
      fireEvent.submit(screen.getByText('Send code').closest('form')!);
      await waitFor(() => {
        expect(screen.getByLabelText('Verification code')).toBeInTheDocument();
      });

      // Close via X button
      fireEvent.click(screen.getByLabelText('Close dialog'));

      expect(onClose).toHaveBeenCalled();
    });
  });
});
