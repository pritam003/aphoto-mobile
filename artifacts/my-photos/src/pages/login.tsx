import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { API_BASE } from "@/lib/api";

/* ── Keyframe animation styles ─────────────────────────────────────────────── */
const ANIM_CSS = `
  @keyframes orb-float {
    0%,100% { transform: translate(0,0) scale(1); }
    25%     { transform: translate(70px,-55px) scale(1.12); }
    50%     { transform: translate(-45px,45px) scale(0.9); }
    75%     { transform: translate(30px,25px) scale(1.06); }
  }
  @keyframes tile-rise {
    0%   { transform: translateY(0) rotate(var(--r)) scale(0.6); opacity:0; }
    8%   { opacity:0.85; transform: translateY(-8vh) rotate(var(--r)) scale(1); }
    80%  { opacity:0.55; }
    100% { transform: translateY(-118vh) rotate(calc(var(--r) + 35deg)) scale(0.7); opacity:0; }
  }
  @keyframes card-in {
    from { opacity:0; transform:translateY(36px) scale(0.95); filter:blur(6px); }
    to   { opacity:1; transform:translateY(0) scale(1); filter:blur(0); }
  }
  @keyframes pulse-ring {
    0%,100% { transform:scale(1); opacity:0.5; }
    50%     { transform:scale(1.3); opacity:0; }
  }
  @keyframes stagger-in {
    from { opacity:0; transform:translateY(14px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes btn-shine {
    0%   { background-position:-300% center; }
    100% { background-position:300% center; }
  }
  @keyframes spin-slow {
    from { transform:rotate(0deg); }
    to   { transform:rotate(360deg); }
  }
`;

/* ── Rising tile config ─────────────────────────────────────────────────── */
const TILE_DEFS = [
  { c1:"#7C3AED",c2:"#4338CA",shape:"50%" },
  { c1:"#0EA5E9",c2:"#1D4ED8",shape:"14px" },
  { c1:"#10B981",c2:"#0891B2",shape:"50%" },
  { c1:"#F43F5E",c2:"#DB2777",shape:"12px" },
  { c1:"#F59E0B",c2:"#EA580C",shape:"50%" },
  { c1:"#8B5CF6",c2:"#6D28D9",shape:"16px" },
  { c1:"#06B6D4",c2:"#2563EB",shape:"50%" },
  { c1:"#84CC16",c2:"#059669",shape:"12px" },
  { c1:"#F472B6",c2:"#A855F7",shape:"50%" },
  { c1:"#34D399",c2:"#3B82F6",shape:"14px" },
  { c1:"#FBBF24",c2:"#F43F5E",shape:"50%" },
  { c1:"#60A5FA",c2:"#A78BFA",shape:"16px" },
  { c1:"#E879F9",c2:"#7C3AED",shape:"50%" },
  { c1:"#4ADE80",c2:"#22D3EE",shape:"12px" },
];
const TILES = TILE_DEFS.map((d, i) => ({
  ...d,
  size: 42 + ((i * 19) % 62),
  left: `${(i * 137.508) % 97}%`,
  delay: `${(i * 1.618) % 9}s`,
  dur: `${14 + (i * 2.1) % 10}s`,
  rotate: `${-22 + (i * 17) % 44}deg`,
}));

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

  /* ── shared full-screen animated background ──────────────────────────── */
  const Background = () => (
    <>
      {/* inject keyframes once */}
      <style>{ANIM_CSS}</style>

      {/* deep dark base */}
      <div className="absolute inset-0 bg-[#07070f]" />

      {/* gradient mesh overlay */}
      <div className="absolute inset-0 opacity-60"
        style={{ background: "radial-gradient(ellipse 80% 60% at 20% 40%, rgba(99,102,241,0.22) 0%, transparent 60%), radial-gradient(ellipse 70% 50% at 80% 70%, rgba(139,92,246,0.18) 0%, transparent 55%), radial-gradient(ellipse 60% 45% at 50% 10%, rgba(14,165,233,0.12) 0%, transparent 50%)" }}
      />

      {/* animated orbs */}
      {[
        { w:520, h:520, top:"5%",  left:"-8%", c:"rgba(99,102,241,0.13)", dur:"22s" },
        { w:460, h:460, top:"45%", right:"-6%",c:"rgba(139,92,246,0.11)", dur:"28s", delay:"6s" },
        { w:380, h:380, bottom:"5%",left:"30%",c:"rgba(14,165,233,0.1)",  dur:"19s", delay:"11s" },
      ].map((orb, i) => (
        <div key={i} className="absolute rounded-full pointer-events-none"
          style={{
            width:orb.w, height:orb.h,
            top:(orb as any).top, left:(orb as any).left,
            right:(orb as any).right, bottom:(orb as any).bottom,
            background:`radial-gradient(circle, ${orb.c}, transparent 70%)`,
            filter:"blur(40px)",
            animation:`orb-float ${orb.dur} ease-in-out infinite`,
            animationDelay:(orb as any).delay ?? "0s",
          }}
        />
      ))}

      {/* rising tiles */}
      {TILES.map(t => (
        <div key={t.id} className="absolute bottom-[-80px] pointer-events-none"
          style={{
            left: t.left,
            width: t.size, height: t.size,
            borderRadius: t.shape,
            background: `linear-gradient(135deg, ${t.c1}, ${t.c2})`,
            opacity: 0,
            boxShadow: `0 4px 24px ${t.c1}55`,
            ["--r" as string]: t.rotate,
            animation: `tile-rise ${t.dur} ease-in-out infinite`,
            animationDelay: t.delay,
          }}
        />
      ))}

      {/* subtle grid overlay */}
      <div className="absolute inset-0 opacity-[0.025]"
        style={{ backgroundImage:"linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)", backgroundSize:"60px 60px" }}
      />
    </>
  );

  // ── Microsoft device-code waiting screen ──────────────────────────────────
  if (deviceCode && userCode && verificationUri) {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
        <Background />
        <div className="relative z-10 w-full max-w-sm"
          style={{ animation:"card-in 0.65s cubic-bezier(0.16,1,0.3,1) forwards" }}>
          <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-2xl p-8 space-y-6">

            {/* Logo */}
            <div className="flex flex-col items-center gap-2 pb-2">
              <div className="relative">
                <div className="absolute inset-0 rounded-full bg-indigo-500/30 blur-xl"
                  style={{ animation:"pulse-ring 2.4s ease-in-out infinite" }} />
                <div className="relative w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                  <svg viewBox="0 0 24 24" className="w-8 h-8 text-white" fill="none">
                    <circle cx="12" cy="12" r="3.5" fill="currentColor" opacity="0.95"/>
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="currentColor" opacity="0.35"/>
                    <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" fill="currentColor" opacity="0.6"/>
                  </svg>
                </div>
              </div>
              <p className="text-xl font-bold text-white tracking-tight">One more step</p>
              <p className="text-sm text-white/50">Complete sign-in in your browser</p>
            </div>

            {/* Step 1 */}
            <div className="space-y-2" style={{ animation:"stagger-in 0.5s 0.15s both" }}>
              <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Step 1 — Copy your code</p>
              <div onClick={handleCopy} className="group cursor-pointer flex items-center justify-between rounded-2xl border border-white/10 bg-white/8 hover:bg-white/12 px-5 py-4 transition-all">
                <span className="font-mono text-3xl font-bold text-white tracking-[0.25em]">{userCode}</span>
                <span className="text-xs text-white/40 group-hover:text-white/70 transition-colors">
                  {copied ? "✓ Copied!" : "Click to copy"}
                </span>
              </div>
            </div>

            {/* Step 2 */}
            <div className="space-y-2" style={{ animation:"stagger-in 0.5s 0.25s both" }}>
              <p className="text-[11px] font-semibold text-white/40 uppercase tracking-widest">Step 2 — Open Microsoft login</p>
              <a href={verificationUri} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full px-5 py-3.5 rounded-2xl bg-[#0078D4] hover:bg-[#106EBE] text-white text-sm font-semibold transition-all shadow-lg shadow-blue-900/30 hover:shadow-blue-900/50 hover:-translate-y-0.5">
                <svg viewBox="0 0 23 23" className="w-4 h-4 shrink-0" fill="none">
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
                Open Microsoft Login →
              </a>
            </div>

            <div className="flex items-center gap-2 text-xs text-white/40" style={{ animation:"stagger-in 0.5s 0.35s both" }}>
              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse inline-block" />
              Waiting for sign-in…
            </div>

            <button onClick={() => { setDeviceCode(null); setUserCode(null); setVerificationUri(null); }}
              className="w-full text-sm text-white/40 hover:text-white/70 py-2.5 rounded-2xl border border-white/8 hover:bg-white/6 transition-all"
              style={{ animation:"stagger-in 0.5s 0.4s both" }}>
              ← Start over
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main login screen ─────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <Background />

      <div className="relative z-10 w-full max-w-md"
        style={{ animation:"card-in 0.7s cubic-bezier(0.16,1,0.3,1) forwards" }}>
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-2xl shadow-[0_32px_64px_rgba(0,0,0,0.5)] p-10 space-y-8">

          {/* Logo */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              {/* outer pulse ring */}
              <div className="absolute -inset-3 rounded-full border border-indigo-400/25"
                style={{ animation:"pulse-ring 2.5s ease-in-out infinite" }} />
              {/* inner pulse ring */}
              <div className="absolute -inset-1.5 rounded-[20px] border border-indigo-400/20"
                style={{ animation:"pulse-ring 2.5s ease-in-out infinite", animationDelay:"0.8s" }} />
              <div className="relative w-16 h-16 rounded-[20px] bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 flex items-center justify-center shadow-xl shadow-indigo-500/40">
                <svg viewBox="0 0 24 24" className="w-9 h-9 text-white" fill="none">
                  <circle cx="12" cy="12" r="3.5" fill="currentColor" opacity="0.95"/>
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8z" fill="currentColor" opacity="0.35"/>
                  <path d="M12 6c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6-2.69-6-6-6zm0 10c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4z" fill="currentColor" opacity="0.6"/>
                </svg>
              </div>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-white text-center tracking-tight">APhoto</h1>
              <p className="text-sm text-white/45 text-center mt-1 tracking-wide">Your memories, beautifully organized</p>
            </div>
          </div>

          {/* Feature pills */}
          <div className="flex items-center justify-center gap-2 flex-wrap"
            style={{ animation:"stagger-in 0.5s 0.2s both" }}>
            {[
              { icon:"📸", label:"Photos" },
              { icon:"🗂️", label:"Albums" },
              { icon:"❤️", label:"Favorites" },
              { icon:"☁️", label:"Cloud backup" },
            ].map(f => (
              <span key={f.label} className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/8 border border-white/8 text-xs text-white/60">
                <span>{f.icon}</span>{f.label}
              </span>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px bg-white/8" style={{ animation:"stagger-in 0.5s 0.3s both" }} />

          {/* Sign in section */}
          <div className="space-y-4" style={{ animation:"stagger-in 0.5s 0.35s both" }}>
            <p className="text-sm text-white/50 text-center">Sign in to continue</p>

            {error && (
              <div className="px-4 py-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-sm text-rose-300">
                {error === "cancelled" ? "Sign-in was cancelled." :
                 error === "expired" ? "Session expired. Please try again." :
                 error === "auth_failed" ? "Authentication failed. Please try again." :
                 `Error: ${error}`}
              </div>
            )}

            <button
              onClick={handleMicrosoftLogin}
              disabled={msLoading}
              data-testid="button-microsoft-login"
              className="group relative w-full overflow-hidden flex items-center gap-4 px-6 py-4 rounded-2xl border border-white/15 bg-white/10 hover:bg-white/16 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/30"
            >
              {/* shine sweep on hover */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background:"linear-gradient(105deg, transparent 30%, rgba(255,255,255,0.08) 50%, transparent 70%)", backgroundSize:"300% 100%", animation:"btn-shine 1.5s ease infinite" }} />

              {msLoading ? (
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full shrink-0"
                  style={{ animation:"spin-slow 0.8s linear infinite" }} />
              ) : (
                <svg viewBox="0 0 23 23" className="w-5 h-5 shrink-0" fill="none">
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
              )}
              <div className="text-left flex-1">
                <p className="text-sm font-semibold text-white">{msLoading ? "Preparing sign-in…" : "Continue with Microsoft"}</p>
                <p className="text-xs text-white/45 mt-0.5">Personal or work account</p>
              </div>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/40 group-hover:text-white/70 group-hover:translate-x-1 transition-all duration-200" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>

          <p className="text-xs text-center text-white/28" style={{ animation:"stagger-in 0.5s 0.5s both" }}>
            By signing in you agree to our{" "}
            <span className="text-white/50 underline underline-offset-2 cursor-pointer hover:text-white/80 transition-colors">Terms</span>
            {" "}and{" "}
            <span className="text-white/50 underline underline-offset-2 cursor-pointer hover:text-white/80 transition-colors">Privacy Policy</span>
          </p>
        </div>
      </div>
    </div>
  );
}
