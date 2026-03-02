import { friendlyErrorMessage } from './friendly-error';
import { ApiError } from './api-client';

describe('friendlyErrorMessage', () => {
  it('returns fallback for non-Error values', () => {
    expect(friendlyErrorMessage('oops', 'Fallback.')).toBe('Fallback.');
    expect(friendlyErrorMessage(null, 'Fallback.')).toBe('Fallback.');
    expect(friendlyErrorMessage(42, 'Fallback.')).toBe('Fallback.');
  });

  describe('network errors', () => {
    it('translates "Failed to fetch" TypeError', () => {
      const err = new TypeError('Failed to fetch');
      expect(friendlyErrorMessage(err, 'x')).toBe(
        'Could not reach the server. Check your internet connection and try again.',
      );
    });

    it('translates "NetworkError" TypeError', () => {
      const err = new TypeError('NetworkError when attempting to fetch resource.');
      expect(friendlyErrorMessage(err, 'x')).toBe(
        'Could not reach the server. Check your internet connection and try again.',
      );
    });

    it('translates "Load failed" TypeError (Safari)', () => {
      const err = new TypeError('Load failed');
      expect(friendlyErrorMessage(err, 'x')).toBe(
        'Could not reach the server. Check your internet connection and try again.',
      );
    });
  });

  it('translates AbortError', () => {
    const err = new DOMException('The operation was aborted.', 'AbortError');
    expect(friendlyErrorMessage(err, 'x')).toBe(
      'The request timed out. Please try again.',
    );
  });

  describe('ApiError (HTTP status codes)', () => {
    it('translates 401', () => {
      const err = new ApiError(401, { error: 'Unauthorized' });
      expect(friendlyErrorMessage(err, 'x')).toMatch(/permission/i);
    });

    it('translates 403', () => {
      const err = new ApiError(403, { error: 'Forbidden' });
      expect(friendlyErrorMessage(err, 'x')).toMatch(/permission/i);
    });

    it('translates 404', () => {
      const err = new ApiError(404, { error: 'Not found' });
      expect(friendlyErrorMessage(err, 'x')).toMatch(/not found/i);
    });

    it('translates 413', () => {
      const err = new ApiError(413, { error: 'Payload too large' });
      expect(friendlyErrorMessage(err, 'x')).toMatch(/too large/i);
    });

    it('passes through 500+ server messages', () => {
      const err = new ApiError(500, { error: 'Internal server error' });
      expect(friendlyErrorMessage(err, 'x')).toBe('Internal server error');
    });

    it('passes through other API error messages', () => {
      const err = new ApiError(422, { error: 'Invalid project data' });
      expect(friendlyErrorMessage(err, 'x')).toBe('Invalid project data');
    });
  });

  it('passes through other Error messages', () => {
    const err = new Error('Something specific happened.');
    expect(friendlyErrorMessage(err, 'x')).toBe('Something specific happened.');
  });

  it('returns fallback when Error has empty message', () => {
    const err = new Error('');
    expect(friendlyErrorMessage(err, 'Fallback.')).toBe('Fallback.');
  });
});
