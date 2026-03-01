/**
 * Translates raw errors into user-friendly messages for display in toasts/UI.
 *
 * Handles network errors (TypeError from fetch), timeouts (AbortError),
 * HTTP status codes (ApiError), and known app-level error messages.
 */
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  // AbortError (request timeout) — check before instanceof Error
  // because DOMException may not extend Error in all environments
  if (err instanceof DOMException && err.name === 'AbortError') {
    return 'The request timed out. Please try again.';
  }

  if (!(err instanceof Error)) return fallback;

  // Network errors from fetch() — browser gives "Failed to fetch" or "NetworkError..." or "Load failed"
  if (err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return 'Could not reach the server. Check your internet connection and try again.';
  }

  // ApiError with HTTP status codes — pass through the server's message
  // which is usually more specific than a generic status-based message
  if ('status' in err && typeof (err as { status: unknown }).status === 'number') {
    const status = (err as { status: number }).status;
    if (status === 401 || status === 403) return 'You don\'t have permission for this action. The project may belong to another user.';
    if (status === 404) return 'Project not found \u2014 it may have been deleted.';
    if (status === 413) return 'Project is too large to save to the cloud.';
    return err.message;
  }

  // Known app-level messages — make more user-friendly
  if (err.message.startsWith('Owner token not found') || err.message.startsWith('No auth credentials available')) {
    return 'Authentication error. Your owner token may be missing or corrupted.';
  }

  return err.message || fallback;
}
