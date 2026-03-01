import { useState, useRef, useCallback } from 'react';
import * as EmailValidator from 'email-validator';
import { Dialog } from '../common/dialog';
import { useAuthActions } from '../../context/auth-context';
import { ApiError } from '../../utils/api-client';

interface LoginDialogProps {
  open: boolean;
  onClose: () => void;
}

type Step = 'email' | 'code';

const inputClasses = `w-full px-3 py-2 rounded-md text-sm
  bg-gray-100 dark:bg-gray-700
  text-gray-800 dark:text-gray-200
  placeholder-gray-400 dark:placeholder-gray-500
  border border-gray-200 dark:border-gray-600
  focus:outline-none focus:ring-2 focus:ring-blue-400 dark:focus:ring-blue-500
  focus:border-transparent`;

const submitButtonClasses = `w-full px-4 py-2 rounded-md text-sm font-medium
  bg-blue-600 text-white hover:bg-blue-500
  disabled:opacity-50 disabled:cursor-not-allowed
  transition-colors`;

export function LoginDialog({ open, onClose }: LoginDialogProps) {
  const { sendCode, verifyCode } = useAuthActions();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStep('email');
    setEmail('');
    setCode('');
    setError(null);
    setIsSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const handleSendCode = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    // RFC 5322-aware check; server uses PHP FILTER_VALIDATE_EMAIL as authority
    if (!trimmed || !EmailValidator.validate(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await sendCode(trimmed);
      setEmail(trimmed);
      setStep('code');
      // Focus the code input after transition
      requestAnimationFrame(() => codeInputRef.current?.focus());
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Too many attempts. Please wait a few minutes.');
      } else {
        setError('Failed to send code. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [email, sendCode]);

  const handleVerifyCode = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!/^\d{6}$/.test(trimmed)) {
      setError('Please enter the 6-digit code from your email.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      await verifyCode(email, trimmed);
      handleClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Invalid or expired code. Please try again.');
      } else {
        setError('Verification failed. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  }, [code, email, verifyCode, handleClose]);

  const handleResend = useCallback(async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      await sendCode(email);
      setCode('');
    } catch {
      setError('Failed to resend code.');
    } finally {
      setIsSubmitting(false);
    }
  }, [email, sendCode]);

  const handleBackToEmail = useCallback(() => {
    setStep('email');
    setCode('');
    setError(null);
  }, []);

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      title="Sign In"
      maxWidth="max-w-sm"
      initialFocusRef={step === 'email' ? emailInputRef : codeInputRef}
    >
      {step === 'email' ? (
        <form onSubmit={handleSendCode} className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Enter your email to receive a sign-in code.
          </p>
          <input
            ref={emailInputRef}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            autoComplete="email"
            className={inputClasses}
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className={submitButtonClasses}
          >
            {isSubmitting ? 'Sending...' : 'Send code'}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerifyCode} className="flex flex-col gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            We sent a 6-digit code to <span className="font-medium text-gray-800 dark:text-gray-200">{email}</span>.
          </p>
          <input
            ref={codeInputRef}
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            aria-label="Verification code"
            autoComplete="one-time-code"
            className={`${inputClasses} text-center tracking-[0.3em] font-mono`}
          />
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400" role="alert">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className={submitButtonClasses}
          >
            {isSubmitting ? 'Verifying...' : 'Verify'}
          </button>
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={handleBackToEmail}
              disabled={isSubmitting}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200
                transition-colors disabled:opacity-50"
            >
              Change email
            </button>
            <button
              type="button"
              onClick={handleResend}
              disabled={isSubmitting}
              className="text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300
                transition-colors disabled:opacity-50"
            >
              Resend code
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
