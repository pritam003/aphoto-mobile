import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadToken, saveToken, clearToken, logout as authLogout } from "../lib/auth";
import { initializeApiClient } from "../lib/api-setup";

interface AuthUser {
  id: string;
  name: string;
  email: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setSession: (token: string, user: AuthUser) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Boot: load persisted token and decode user from JWT payload
  useEffect(() => {
    initializeApiClient();
    (async () => {
      try {
        const stored = await loadToken();
        if (stored) {
          const decoded = decodeJwtPayload(stored);
          if (decoded && decoded.exp && decoded.exp * 1000 > Date.now()) {
            setToken(stored);
            setUser({ id: decoded.sub, name: decoded.name, email: decoded.email });
          } else {
            await clearToken();
          }
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const setSession = useCallback(async (newToken: string, newUser: AuthUser) => {
    await saveToken(newToken);
    setToken(newToken);
    setUser(newUser);
  }, []);

  const logout = useCallback(async () => {
    await authLogout(token);
    setToken(null);
    setUser(null);
    queryClient.clear();
  }, [token, queryClient]);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user,
        setSession,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuthContext must be used inside AuthProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Minimal JWT decode (no verification — server already verified on issue)
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): {
  sub: string;
  name: string;
  email: string;
  exp: number;
} | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64").toString("utf8")
    );
    return payload as { sub: string; name: string; email: string; exp: number };
  } catch {
    return null;
  }
}
