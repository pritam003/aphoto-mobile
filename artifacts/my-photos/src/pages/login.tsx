import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { API_BASE } from "@/lib/api";

const VITE_API_URL = import.meta.env.VITE_API_URL || "";

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  const [msLoading, setMsLoading] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);

  const [error, setError] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("error");
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/");
  }, [isAuthenticated, isLoading, navigate]);

  // Check if Google SSO is configured on the backend
  useEffect(() => {
    fetch(`${API_BASE}/auth/config`)
      .then(r => r.json())
      .then((cfg: { google?: boolean }) => setGoogleEnabled(!!cfg.google))
      .catch(() => {/* ignore */});
  }, []);

  // Poll Microsoft device code
  useEffect(() => {
    if (!deviceCode) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/auth/device-code-status`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ device_code: deviceCode }),
          credentials: "include",
        });
        const data = await res.json() as { status?: string };
        if (res.ok && data.status === "success") {
          clearInterval(interval);
          navigate("/");
        } else if (res.status === 410) {
          clearInterval(interval);
          setDeviceCode(null); setUserCode(null); setVerificationUri(null);
          setError("Device code expired. Please try again.");
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [deviceCode, navigate]);

  const handleGoogleLogin = () => {
    window.location.href = `${VITE_API_URL}/api/auth/google`;
  };

  const handleMicrosoftLogin = async () => {
    setMsLoading(true); setError(null);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to start login");
      const data = await res.json() as { device_code: string; user_code: string; verification_uri: string };
      setDeviceCode(data.device_code);
      setUserCode(data.user_code);
      setVerificationUri(data.verification_uri);
    } catch (e) {
      setError(`Login failed: ${String(e)}`);
    } finally {
      setMsLoading(false);
    }
  };

  // ── Microsoft device-code waiting screen ──────────────────────────────────
  if (deviceCode && userCode && verificationUri) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm px-6 space-y-5">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground">Sign in with Microsoft</h1>
            <p className="mt-1 text-sm text-muted-foreground">Complete the login in your browser</p>
          </div>
          <div className="bg-muted p-5 rounded-xl border border-border space-y-4">
            <div>
              <p className="text-xs font-medium text-foreground mb-1.5">1. Copy your code</p>
              <div className="bg-background p-3 rounded-lg text-center font-mono text-2xl font-bold text-primary tracking-widest border border-primary/30">
                {userCode}
              </div>
              <button
                onClick={() => navigator.clipboard.writeText(userCode)}
                className="w-full mt-1.5 text-xs text-primary hover:underline"
              >Copy code</button>
            </div>
            <div>
              <p className="text-xs font-medium text-foreground mb-1.5">2. Open the login page</p>
              <a
                href={verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full px-4 py-2.5 bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-medium text-center rounded-lg transition-colors"
              >Open Microsoft Login →</a>
            </div>
          </div>
          <p className="text-xs text-center text-muted-foreground animate-pulse">Waiting for sign in…</p>
          <button
            onClick={() => { setDeviceCode(null); setUserCode(null); setVerificationUri(null); }}
            className="w-full text-sm text-muted-foreground hover:text-foreground py-2 rounded-lg hover:bg-muted transition-colors"
          >Cancel</button>
        </div>
      </div>
    );
  }

  // ── Main login screen ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-6">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-5">
            <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none">
              <rect x="3" y="3" width="7" height="7" rx="1.5" fill="currentColor" className="text-primary" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" fill="currentColor" className="text-primary opacity-70" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" fill="currentColor" className="text-primary opacity-70" />
              <rect x="14" y="14" width="7" height="7" rx="1.5" fill="currentColor" className="text-primary opacity-40" />
            </svg>
          </div>
          <h1 className="text-3xl font-semibold text-foreground tracking-tight">My Photos</h1>
          <p className="mt-2 text-sm text-muted-foreground">Your personal photo library</p>
        </div>

        {error && (
          <div className="mb-5 px-4 py-3 bg-destructive/10 border border-destructive/30 rounded-lg text-sm text-destructive">
            {error === "cancelled" ? "Sign-in was cancelled." :
             error === "expired" ? "Session expired. Please try again." :
             error === "auth_failed" ? "Authentication failed. Please try again." :
             `Sign-in error: ${error}`}
          </div>
        )}

        <div className="space-y-3">
          {/* Microsoft — always primary */}
          <button
            onClick={handleMicrosoftLogin}
            disabled={msLoading}
            data-testid="button-microsoft-login"
            className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-[#0078D4] hover:bg-[#106EBE] disabled:opacity-60 text-white font-medium rounded-xl text-sm shadow-sm transition-colors"
          >
            <svg viewBox="0 0 23 23" className="w-4 h-4" fill="none">
              <path fill="#f35325" d="M1 1h10v10H1z"/>
              <path fill="#81bc06" d="M12 1h10v10H12z"/>
              <path fill="#05a6f0" d="M1 12h10v10H1z"/>
              <path fill="#ffba08" d="M12 12h10v10H12z"/>
            </svg>
            {msLoading ? "Starting…" : "Continue with Microsoft"}
          </button>

          {/* Google — only shown when backend has it configured */}
          {googleEnabled && (
            <>
              <div className="flex items-center gap-3 py-1">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground">or</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <button
                onClick={handleGoogleLogin}
                data-testid="button-google-login"
                className="w-full flex items-center justify-center gap-3 px-5 py-3 bg-white dark:bg-zinc-800 border border-border hover:bg-muted/60 text-foreground font-medium rounded-xl text-sm shadow-sm transition-colors"
              >
                <svg viewBox="0 0 24 24" className="w-5 h-5" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </button>
            </>
          )}
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Sign in to access your personal photo library
        </p>
      </div>
    </div>
  );
}
