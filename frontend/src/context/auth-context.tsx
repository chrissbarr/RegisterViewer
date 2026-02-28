import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { isCloudEnabled, sendLoginCode as apiSendLoginCode, verifyLoginCode as apiVerifyLoginCode, getAuthMe } from '../utils/api-client';
import { getOwnerTokenHash } from '../utils/owner-token';

const JWT_KEY = 'register-viewer-jwt';

interface AuthUser {
  id: number;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
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
    return localStorage.getItem(JWT_KEY);
  } catch {
    return null;
  }
}

function storeJwt(token: string): void {
  try {
    localStorage.setItem(JWT_KEY, token);
  } catch {
    // localStorage may be full or disabled
  }
}

function clearJwt(): void {
  try {
    localStorage.removeItem(JWT_KEY);
  } catch {
    // ignore
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(() => {
    // Only show loading if there's a JWT to validate and cloud is enabled
    return isCloudEnabled() && readJwt() !== null;
  });

  // Validate existing JWT on mount
  useEffect(() => {
    const jwt = readJwt();
    if (!jwt || !isCloudEnabled()) {
      // isLoading was initialized to false for this case, nothing to do
      return;
    }

    let cancelled = false;
    getAuthMe(jwt)
      .then((res) => {
        if (!cancelled) setUser(res.user);
      })
      .catch(() => {
        if (!cancelled) clearJwt();
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  const sendCode = useCallback(async (email: string) => {
    await apiSendLoginCode(email);
  }, []);

  const verifyCode = useCallback(async (email: string, code: string) => {
    const ownerTokenHash = await getOwnerTokenHash();
    const res = await apiVerifyLoginCode(email, code, ownerTokenHash);
    storeJwt(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => {
    clearJwt();
    setUser(null);
  }, []);

  const getJwt = useCallback((): string | null => {
    return readJwt();
  }, []);

  const state = useMemo<AuthState>(() => ({ user, isLoading }), [user, isLoading]);
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
