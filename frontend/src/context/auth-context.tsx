import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { isCloudEnabled, sendLoginCode as apiSendLoginCode, verifyLoginCode as apiVerifyLoginCode, getAuthMe, postAuthLogout } from '../utils/api-client';

/** localStorage key for the JWT token. Exported for use by AppLoader (pre-context). */
export const JWT_STORAGE_KEY = 'register-viewer-jwt';

interface AuthUser {
  id: number;
  email: string;
}

/**
 * Decode a JWT payload without verification (base64url → JSON).
 * Returns null for malformed or expired tokens.
 */
function parseJwtPayload(token: string): AuthUser | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64 + '='.repeat((4 - base64.length % 4) % 4)));
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    if (typeof payload.sub !== 'number' || typeof payload.email !== 'string') return null;
    return { id: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

interface AuthState {
  user: AuthUser | null;
}

interface AuthActions {
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<void>;
  logout: () => void;
  getJwt: () => string | null;
}

const AuthStateContext = createContext<AuthState | null>(null);
const AuthActionsContext = createContext<AuthActions | null>(null);

function readJwt(): string | null {
  try {
    return localStorage.getItem(JWT_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeJwt(token: string): void {
  try {
    localStorage.setItem(JWT_STORAGE_KEY, token);
  } catch {
    // localStorage may be full or disabled
  }
}

function clearJwt(): void {
  try {
    localStorage.removeItem(JWT_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => {
    if (!isCloudEnabled()) return null;
    const jwt = readJwt();
    return jwt ? parseJwtPayload(jwt) : null;
  });
  // Background-validate the JWT on mount (clear user if revoked/invalid)
  useEffect(() => {
    const jwt = readJwt();
    if (!jwt || !isCloudEnabled()) return;

    let cancelled = false;
    getAuthMe(jwt)
      .then((res) => {
        if (!cancelled) {
          setUser(res.user);
          if (res.refreshedToken) storeJwt(res.refreshedToken);
        }
      })
      .catch(() => {
        if (!cancelled) {
          clearJwt();
          setUser(null);
        }
      });

    return () => { cancelled = true; };
  }, []);

  const sendCode = useCallback(async (email: string) => {
    await apiSendLoginCode(email);
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const res = await apiVerifyLoginCode(email, code);
    storeJwt(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    const jwt = readJwt();
    clearJwt();
    setUser(null);
    // Revoke the token server-side (best-effort, don't block on result)
    if (jwt && isCloudEnabled()) {
      postAuthLogout(jwt).catch(() => { /* best-effort */ });
    }
  }, []);

  const getJwt = useCallback((): string | null => {
    return readJwt();
  }, []);

  const state = useMemo<AuthState>(() => ({ user }), [user]);
  const actions = useMemo<AuthActions>(() => ({ sendCode, verifyCode, logout, getJwt }), [sendCode, verifyCode, logout, getJwt]);

  return (
    <AuthStateContext.Provider value={state}>
      <AuthActionsContext.Provider value={actions}>
        {children}
      </AuthActionsContext.Provider>
    </AuthStateContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthStateContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function useAuthActions(): AuthActions {
  const ctx = useContext(AuthActionsContext);
  if (!ctx) throw new Error('useAuthActions must be used within AuthProvider');
  return ctx;
}
