import { useCallback, useRef, useState, type MutableRefObject } from 'react';

interface UseLoginGuardDeps {
  getJwt: () => string | null;
  rawSave: () => Promise<boolean>;
  rawFork: () => Promise<void>;
}

interface UseLoginGuardResult {
  loginRequired: boolean;
  pendingCloudOpRef: MutableRefObject<'save' | 'fork' | null>;
  setLoginRequired: (v: boolean) => void;
  saveToCloud: () => Promise<boolean | undefined>;
  fork: () => Promise<void>;
  cancelPendingOp: () => void;
}

/**
 * JWT guard for cloud operations.
 *
 * Wraps save/fork with a JWT check. When no JWT is available, stores
 * the pending operation type and sets `loginRequired` to trigger the
 * login dialog. After login, the auth-transition effect retries
 * the operation via `pendingCloudOpRef`.
 */
export function useLoginGuard(deps: UseLoginGuardDeps): UseLoginGuardResult {
  const { getJwt, rawSave, rawFork } = deps;

  const [loginRequired, setLoginRequired] = useState(false);
  const pendingCloudOpRef = useRef<'save' | 'fork' | null>(null);

  /** Wraps rawSave with JWT guard. Returns `undefined` (deferred to login) when no JWT is available. */
  const saveToCloud = useCallback(async (): Promise<boolean | undefined> => {
    if (!getJwt()) {
      pendingCloudOpRef.current = 'save';
      setLoginRequired(true);
      return;
    }
    return rawSave();
  }, [getJwt, rawSave]);

  const fork = useCallback(async () => {
    if (!getJwt()) {
      pendingCloudOpRef.current = 'fork';
      setLoginRequired(true);
      return;
    }
    return rawFork();
  }, [getJwt, rawFork]);

  const cancelPendingOp = useCallback(() => {
    pendingCloudOpRef.current = null;
    setLoginRequired(false);
  }, []);

  return { loginRequired, pendingCloudOpRef, setLoginRequired, saveToCloud, fork, cancelPendingOp };
}
