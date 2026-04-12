import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { API_BASE } from "@/lib/api";

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  const [msLoading, setMsLoading] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [error, setError] = useState<string | null>(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("error");
  });

  useEffect(() => {
    if (!isLoading && isAuthenticated) navigate("/");
  }, [isAuthenticated, isLoading, navigate]);

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
          setError("Code expired. Please try again.");
        }
      } catch { /* keep polling */ }
    }, 2000);
    return () => clearInterval(interval);
  }, [deviceCode, navigate]);

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

  const handleCopy = () => {
    if (userCode) {
      navigator.clipboard.writeText(userCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // ── Microsoft device-code waiting screen ──────────────────────────────────
  if (deviceCode && userCode && verificationUri) {
    return (
      <div className="min-h-screen flex bg-background">
        {/* Left decorative panel */}
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 items-center justify-center p-12">
          <DecorativeGrid />
          <div className="relative z-10 text-center">
            <APhotoLogo size="lg" />
            <p className="mt-4 text-slate-300 text-lg font-light">Your memories, beautifully organized</p>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="w-full max-w-sm space-y-6">
            <div className="lg:hidden mb-6">
              <APhotoLogo size="sm" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-foreground">One more step</h2>
              <p className="mt-1 text-sm text-muted-foreground">Complete sign-in in your browser</p>
            </div>

            {/* Step 1 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Step 1 — Copy your code</p>
              <div
                onClick={handleCopy}
                className="group relative flex items-center justify-between bg-muted hover:bg-muted/80 cursor-pointer border border-border rounded-xl px-5 py-4 transition-colors"
              >
                <span className="font-mono text-3xl font-bold text-primary tracking-[0.25em]">{userCode}</span>
                <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                  {copied ? "✓ Copied!" : "Click to copy"}
                </span>
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Step 2 — Open Microsoft login</p>
              <a
                href={verificationUri}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full px-5 py-3.5 bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-semibold rounded-xl transition-colors shadow-md shadow-blue-900/20"
              >
                <svg viewBox="0 0 23 23" className="w-4 h-4 shrink-0" fill="none">
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
                Open Microsoft Login →
              </a>
            </div>

            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="inline-block w-2 h-2 rounded-full bg-primary animate-pulse" />
              Waiting for sign-in…
            </div>

            <button
              onClick={() => { setDeviceCode(null); setUserCode(null); setVerificationUri(null); }}
              className="w-full text-sm text-muted-foreground hover:text-foreground py-2.5 rounded-xl border border-border hover:bg-muted transition-colors"
            >
              ← Start over
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main login screen ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen flex bg-background">
      {/* Left decorative panel */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 items-center justify-center p-12">
        <DecorativeGrid />
        <div className="relative z-10 text-center space-y-4">
          <APhotoLogo size="lg" />
          <p className="text-slate-300 text-lg font-light leading-relaxed max-w-xs">
            Your memories, beautifully<br />organized and always accessible
          </p>
          <div className="flex items-center justify-center gap-6 pt-4">
            {["Photos", "Albums", "Favorites"].map((label) => (
              <div key={label} className="text-center">
                <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center mx-auto mb-1.5">
                  {label === "Photos" && <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-200" fill="none" stroke="currentColor" strokeWidth="1.75"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor" stroke="none"/><path d="M3 16l5-5 4 4 3-3 6 6"/></svg>}
                  {label === "Albums" && <svg viewBox="0 0 24 24" className="w-5 h-5 text-slate-200" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="M2 7h20M6 3h12M5 11h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2z"/></svg>}
                  {label === "Favorites" && <svg viewBox="0 0 24 24" className="w-5 h-5 text-rose-300" fill="currentColor"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>}
                </div>
                <span className="text-xs text-slate-400">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right sign-in panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm space-y-8">
          {/* Mobile logo */}
          <div className="lg:hidden">
            <APhotoLogo size="sm" />
          </div>

          <div>
            <h2 className="text-3xl font-bold text-foreground tracking-tight">Welcome back</h2>
            <p className="mt-2 text-muted-foreground">Sign in to your APhoto account</p>
          </div>

          {error && (
            <div className="px-4 py-3 bg-destructive/10 border border-destructive/20 rounded-xl text-sm text-destructive">
              {error === "cancelled" ? "Sign-in was cancelled." :
               error === "expired" ? "Session expired. Please try again." :
               error === "auth_failed" ? "Authentication failed. Please try again." :
               `Error: ${error}`}
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleMicrosoftLogin}
              disabled={msLoading}
              data-testid="button-microsoft-login"
              className="group w-full flex items-center gap-4 px-5 py-4 rounded-2xl border border-border bg-card hover:bg-muted/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 shadow-sm hover:shadow-md"
            >
              {msLoading ? (
                <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin shrink-0" />
              ) : (
                <svg viewBox="0 0 23 23" className="w-5 h-5 shrink-0" fill="none">
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
              )}
              <div className="text-left flex-1">
                <p className="text-sm font-semibold text-foreground">{msLoading ? "Preparing sign-in…" : "Continue with Microsoft"}</p>
                <p className="text-xs text-muted-foreground">Personal or work account</p>
              </div>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>

          <p className="text-xs text-center text-muted-foreground">
            By signing in you agree to our{" "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors">Terms</span>
            {" "}and{" "}
            <span className="underline underline-offset-2 cursor-pointer hover:text-foreground transition-colors">Privacy Policy</span>
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function APhotoLogo({ size }: { size: "sm" | "lg" }) {
  const iconSize = size === "lg" ? "w-16 h-16" : "w-10 h-10";
  const textSize = size === "lg" ? "text-4xl" : "text-2xl";
  const dotSize = size === "lg" ? "w-2.5 h-2.5 -mt-1" : "w-1.5 h-1.5 -mt-0.5";
  const color = size === "lg" ? "text-white" : "text-foreground";
  const mutedColor = size === "lg" ? "text-indigo-300" : "text-muted-foreground";
  return (
    <div className="flex flex-col items-center gap-3">
      <div className={`${iconSize} rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center`}>
        <svg viewBox="0 0 24 24" className={size === "lg" ? "w-9 h-9 text-white" : "w-6 h-6 text-foreground"} fill="none">
          <circle cx="12" cy="12" r="3.5" fill="currentColor" opacity="0.9" />
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="currentColor" opacity="0.35" />
          <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" fill="currentColor" opacity="0.6" />
        </svg>
      </div>
      <div className="flex items-start gap-0.5">
        <span className={`${textSize} font-bold tracking-tight ${color}`}>APhoto</span>
        <span className={`${dotSize} rounded-full bg-indigo-400 inline-block`} />
      </div>
      {size === "lg" && <span className={`text-sm ${mutedColor} tracking-wide`}>aphoto.app</span>}
    </div>
  );
}

function DecorativeGrid() {
  const tiles = [
    { top: "5%", left: "5%", size: 120, rotate: -8, opacity: 0.12 },
    { top: "5%", right: "5%", size: 90, rotate: 12, opacity: 0.1 },
    { bottom: "10%", left: "8%", size: 100, rotate: 5, opacity: 0.1 },
    { bottom: "5%", right: "10%", size: 140, rotate: -12, opacity: 0.08 },
    { top: "40%", left: "-2%", size: 80, rotate: 20, opacity: 0.09 },
    { top: "35%", right: "-1%", size: 110, rotate: -15, opacity: 0.11 },
  ] as const;
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {tiles.map((t, i) => (
        <div
          key={i}
          className="absolute rounded-2xl bg-white"
          style={{
            width: t.size, height: t.size,
            top: (t as any).top, left: (t as any).left,
            bottom: (t as any).bottom, right: (t as any).right,
            opacity: t.opacity,
            transform: `rotate(${t.rotate}deg)`,
          }}
        />
      ))}
      {/* Radial glow */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(99,102,241,0.15)_0%,transparent_70%)]" />
    </div>
  );
}
