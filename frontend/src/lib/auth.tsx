import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { apiGet, apiPost, setToken, setUnauthorizedHandler, getToken, OfflineError } from "@/lib/api";
import type { LoginPayload, MeOut, RegisterPayload, SessionOut, Store, User } from "@/lib/types";

const SESSION_CACHE_KEY = "kasirku.session";

interface AuthState {
  user: User | null;
  store: Store | null;
  permissions: string[];
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (payload: LoginPayload) => Promise<void>;
  register: (payload: RegisterPayload) => Promise<void>;
  logout: () => void;
  /** Re-pull /auth/me — used after renaming your own account so the header updates. */
  refreshSession: () => Promise<void>;
  can: (action: string) => boolean;
  isOwner: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Cached so the PWA can boot into the shell while offline instead of bouncing to /login. */
function readCachedSession(): { user: User; store: Store; permissions: string[] } | null {
  try {
    const raw = localStorage.getItem(SESSION_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCachedSession(value: { user: User; store: Store; permissions: string[] } | null): void {
  try {
    if (value) localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_CACHE_KEY);
  } catch {
    /* ignore quota/private-mode errors */
  }
}

const PERMISSIONS_BY_ROLE: Record<string, string[]> = {
  pemilik: ["product:read", "product:write", "transaction:create", "transaction:read", "transaction:void", "report:read", "user:manage", "cost:read"],
  kasir: ["product:read", "transaction:create", "transaction:read"],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const cached = getToken() ? readCachedSession() : null;
  const [state, setState] = useState<AuthState>({
    user: cached?.user ?? null,
    store: cached?.store ?? null,
    permissions: cached?.permissions ?? [],
    loading: getToken() !== null,
  });

  const clearSession = useCallback(() => {
    setToken(null);
    writeCachedSession(null);
    setState({ user: null, store: null, permissions: [], loading: false });
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    return () => setUnauthorizedHandler(null);
  }, [clearSession]);

  // Re-validate the token against the server on boot; the role/store may have changed.
  useEffect(() => {
    if (!getToken()) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    let cancelled = false;
    apiGet<MeOut>("/auth/me")
      .then((me) => {
        if (cancelled) return;
        writeCachedSession({ user: me.user, store: me.store, permissions: me.permissions });
        setState({ user: me.user, store: me.store, permissions: me.permissions, loading: false });
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof OfflineError) {
          // Offline: keep working from the cached session instead of forcing a login.
          setState((s) => ({ ...s, loading: false }));
        } else {
          clearSession();
        }
      });
    return () => {
      cancelled = true;
    };
  }, [clearSession]);

  const applySession = useCallback((session: SessionOut) => {
    setToken(session.token);
    const permissions = PERMISSIONS_BY_ROLE[session.user.role] ?? [];
    writeCachedSession({ user: session.user, store: session.store, permissions });
    setState({ user: session.user, store: session.store, permissions, loading: false });
  }, []);

  const login = useCallback(
    async (payload: LoginPayload) => {
      applySession(await apiPost<SessionOut>("/auth/login", payload));
    },
    [applySession],
  );

  const register = useCallback(
    async (payload: RegisterPayload) => {
      applySession(await apiPost<SessionOut>("/auth/register", payload));
    },
    [applySession],
  );

  const refreshSession = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await apiGet<MeOut>("/auth/me");
      writeCachedSession({ user: me.user, store: me.store, permissions: me.permissions });
      setState({ user: me.user, store: me.store, permissions: me.permissions, loading: false });
    } catch {
      /* offline or transient: keep the current session as-is */
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      register,
      logout: clearSession,
      refreshSession,
      can: (action: string) => state.permissions.includes(action),
      isOwner: state.user?.role === "pemilik",
    }),
    [state, login, register, clearSession, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}