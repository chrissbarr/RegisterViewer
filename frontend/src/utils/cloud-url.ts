import type { MutableRefObject } from 'react';

/** Navigate the browser hash to a cloud project URL without a page reload. */
export function setCloudUrl(cloudId: string): void {
  history.replaceState(null, '', `#/p/${cloudId}`);
}

/** Clear the cloud project hash from the URL. */
export function clearCloudUrl(): void {
  history.replaceState(null, '', window.location.pathname + window.location.search);
}

/** Metadata payload that fully unlinks a project from the cloud. */
export const CLEARED_CLOUD_METADATA = {
  cloudId: null,
  visibility: 'private' as const,
  cloudSavedAt: null,
  storage: 'local' as const,
};

/**
 * Execute `fn` only if the lock ref is not already held.
 * Acquires the lock before running and releases it in `finally`.
 * Returns `undefined` (without calling `fn`) when the lock is already held.
 */
export async function withMutationLock<T>(
  ref: MutableRefObject<boolean>,
  fn: () => Promise<T>,
): Promise<T | undefined> {
  if (ref.current) {
    console.warn('[cloud-sync] mutation dropped — another operation is in progress');
    return;
  }
  ref.current = true;
  try {
    return await fn();
  } finally {
    ref.current = false;
  }
}
