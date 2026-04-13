import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { API_BASE } from "@/lib/api";

/* ── Keyframes ──────────────────────────────────────────────────────────── */
const ANIM_CSS = `
  @keyframes emoji-pop {
    0%   { opacity:0; transform: translateY(0) scale(0.3) rotate(var(--er)); }
    12%  { opacity:1; transform: translateY(calc(var(--ey) * 0.1)) scale(1.2) rotate(var(--er)); }
    20%  { transform: translateY(calc(var(--ey) * 0.18)) scale(1) rotate(calc(var(--er) + 8deg)); }
    80%  { opacity:0.7; }
    100% { opacity:0; transform: translateY(var(--ey)) scale(0.5) rotate(calc(var(--er) + 30deg)); }
  }
  @keyframes emoji-sway {
    0%,100% { transform: translateX(0); }
    50%     { transform: translateX(var(--sx)); }
  }
  @keyframes card-enter {
    from { opacity:0; transform:translateY(40px) scale(0.93); }
    to   { opacity:1; transform:translateY(0)   scale(1); }
  }
  @keyframes fade-up {
    from { opacity:0; transform:translateY(12px); }
    to   { opacity:1; transform:translateY(0); }
  }
  @keyframes glow-pulse {
    0%,100% { opacity:0.55; transform:scale(1); }
    50%     { opacity:0.9;  transform:scale(1.08); }
  }
  @keyframes shimmer {
    0%   { background-position:-400% center; }
    100% { background-position:400% center; }
  }
  @keyframes spin {
    to { transform:rotate(360deg); }
  }
  @keyframes soft-float {
    0%,100% { transform:translateY(0); }
    50%     { transform:translateY(-12px); }
  }
`;

/* ── Emoji particle config ─────────────────────────────────────────────── */
const EMOJIS = ["📸","🖼️","🌄","🤳","🗂️","📷","🌅","❤️","✨","🎞️","🌠","📸","🖼️","📷","🌄","✨","🗂️","🌅"];
const PARTICLES = EMOJIS.map((em, i) => ({
  id: i,
  emoji: em,
  left: `${(i * 137.508 + 5) % 94}%`,
  size: 22 + ((i * 11) % 24),          // 22–46 px font size
  delay: `${(i * 1.35) % 11}s`,
  dur: `${10 + (i * 1.7) % 9}s`,
  swayDur: `${3 + (i * 0.6) % 4}s`,
  ey: `-${85 + (i * 7) % 30}vh`,        // how far up it floats
  er: `${-25 + (i * 13) % 50}deg`,
  sx: `${-18 + (i * 8) % 36}px`,
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

  /* ── Shared animated background ─────────────────────────────────────── */
  const Bg = () => (
    <>
      <style>{ANIM_CSS}</style>
      {/* Warm gradient base — deep purple → midnight blue */}
      <div className="absolute inset-0"
        style={{ background: "linear-gradient(145deg,#0f0620 0%,#0a0d2e 40%,#07121f 70%,#0e0520 100%)" }} />

      {/* Soft color blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full"
          style={{ width:700,height:700,top:"-15%",left:"-12%",
            background:"radial-gradient(circle,rgba(139,92,246,0.18) 0%,transparent 65%)",
            animation:"glow-pulse 7s ease-in-out infinite" }} />
        <div className="absolute rounded-full"
          style={{ width:600,height:600,bottom:"-10%",right:"-10%",
            background:"radial-gradient(circle,rgba(236,72,153,0.14) 0%,transparent 65%)",
            animation:"glow-pulse 9s ease-in-out infinite",animationDelay:"3s" }} />
        <div className="absolute rounded-full"
          style={{ width:500,height:500,top:"30%",right:"15%",
            background:"radial-gradient(circle,rgba(59,130,246,0.12) 0%,transparent 65%)",
            animation:"glow-pulse 6s ease-in-out infinite",animationDelay:"1.5s" }} />
      </div>

      {/* Rising emoji particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {PARTICLES.map(p => (
          <div key={p.id}
            style={{
              position:"absolute",
              bottom:"-60px",
              left: p.left,
              fontSize: p.size,
              lineHeight:1,
              opacity:0,
              ["--ey" as string]: p.ey,
              ["--er" as string]: p.er,
              ["--sx" as string]: p.sx,
              animation: `emoji-pop ${p.dur} ease-in-out ${p.delay} infinite`,
            }}>
            <span style={{ display:"inline-block",
              animation:`emoji-sway ${p.swayDur} ease-in-out infinite` }}>
              {p.emoji}
            </span>
          </div>
        ))}
      </div>

      {/* Fine grid overlay */}
      <div className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{ backgroundImage:"linear-gradient(rgba(255,255,255,1) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,1) 1px,transparent 1px)", backgroundSize:"48px 48px" }} />
    </>
  );

  /* ── Device-code step ────────────────────────────────────────────────── */
  if (deviceCode && userCode && verificationUri) {
    return (
      <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
        <Bg />
        <div className="relative z-10 w-full max-w-sm"
          style={{ animation:"card-enter 0.6s cubic-bezier(0.16,1,0.3,1) both" }}>
          <div style={{
            background:"rgba(15,6,32,0.72)",
            backdropFilter:"blur(28px)",
            WebkitBackdropFilter:"blur(28px)",
            border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:28,
            padding:"2.5rem",
            boxShadow:"0 40px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.08)"
          }}>
            {/* Logo */}
            <div className="flex flex-col items-center gap-2 mb-7">
              <div className="text-5xl" style={{ animation:"soft-float 3s ease-in-out infinite" }}>📸</div>
              <h2 className="text-xl font-bold text-white tracking-tight">One more step</h2>
              <p className="text-sm text-white/45">Complete sign-in in your browser</p>
            </div>

            {/* Step 1 */}
            <div className="mb-4" style={{ animation:"fade-up 0.5s 0.1s both" }}>
              <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-2">Step 1 — Copy your code</p>
              <div onClick={handleCopy} className="group cursor-pointer flex items-center justify-between rounded-2xl px-5 py-4 transition-all"
                style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)" }}>
                <span className="font-mono text-3xl font-bold text-white tracking-[0.3em]">{userCode}</span>
                <span className="text-xs text-white/40 group-hover:text-purple-300 transition-colors">
                  {copied ? "✓ Copied!" : "tap to copy"}
                </span>
              </div>
            </div>

            {/* Step 2 */}
            <div className="mb-5" style={{ animation:"fade-up 0.5s 0.2s both" }}>
              <p className="text-[10px] font-bold text-purple-400 uppercase tracking-widest mb-2">Step 2 — Open link</p>
              <a href={verificationUri} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-3 w-full py-3.5 rounded-2xl text-white text-sm font-semibold transition-all hover:-translate-y-0.5"
                style={{ background:"linear-gradient(135deg,#0078D4,#1a56db)", boxShadow:"0 8px 24px rgba(0,120,212,0.35)" }}>
                <svg viewBox="0 0 23 23" className="w-4 h-4 shrink-0" fill="none">
                  <path fill="#f35325" d="M1 1h10v10H1z"/>
                  <path fill="#81bc06" d="M12 1h10v10H12z"/>
                  <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                  <path fill="#ffba08" d="M12 12h10v10H12z"/>
                </svg>
                Open Microsoft Login →
              </a>
            </div>

            <div className="flex items-center gap-2 text-xs text-white/35 mb-5" style={{ animation:"fade-up 0.5s 0.3s both" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block animate-pulse" />
              Waiting for you to sign in…
            </div>

            <button onClick={() => { setDeviceCode(null); setUserCode(null); setVerificationUri(null); }}
              className="w-full py-2.5 rounded-2xl text-sm text-white/35 hover:text-white/65 transition-colors"
              style={{ border:"1px solid rgba(255,255,255,0.08)" }}>
              ← Start over
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ── Main login ──────────────────────────────────────────────────────── */
  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 overflow-hidden">
      <Bg />

      <div className="relative z-10 w-full max-w-[420px]"
        style={{ animation:"card-enter 0.65s cubic-bezier(0.16,1,0.3,1) both" }}>
        <div style={{
          background:"rgba(12,4,28,0.75)",
          backdropFilter:"blur(32px)",
          WebkitBackdropFilter:"blur(32px)",
          border:"1px solid rgba(255,255,255,0.1)",
          borderRadius:32,
          padding:"2.75rem",
          boxShadow:"0 48px 96px rgba(0,0,0,0.65), inset 0 1px 0 rgba(255,255,255,0.1)"
        }}>

          {/* Hero emoji + title */}
          <div className="flex flex-col items-center gap-3 mb-8">
            {/* Big camera with floating ring */}
            <div className="relative flex items-center justify-center">
              <div className="absolute w-24 h-24 rounded-full"
                style={{ background:"radial-gradient(circle,rgba(139,92,246,0.35),transparent 70%)",
                  animation:"glow-pulse 2.8s ease-in-out infinite" }} />
              <span className="relative text-[64px] leading-none select-none"
                style={{ animation:"soft-float 3.5s ease-in-out infinite", filter:"drop-shadow(0 8px 24px rgba(139,92,246,0.5))" }}>
                📷
              </span>
            </div>

            <h1 className="text-[2rem] font-black text-white tracking-tight leading-none mt-1"
              style={{ animation:"fade-up 0.5s 0.05s both" }}>
              APhoto
            </h1>
            <p className="text-sm text-white/45 text-center leading-relaxed"
              style={{ animation:"fade-up 0.5s 0.12s both" }}>
              Your memories, beautifully organized
            </p>
          </div>

          {/* Feature row */}
          <div className="flex items-center justify-center gap-2 flex-wrap mb-7"
            style={{ animation:"fade-up 0.5s 0.18s both" }}>
            {[["📸","Photos"],["🖼️","Albums"],["❤️","Favorites"],["☁️","Backup"]].map(([icon, label]) => (
              <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-white/55 font-medium"
                style={{ background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.08)" }}>
                <span>{icon}</span>{label}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px mb-7" style={{ background:"rgba(255,255,255,0.07)", animation:"fade-up 0.5s 0.22s both" }} />

          {/* Error */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-2xl text-sm text-rose-300"
              style={{ background:"rgba(244,63,94,0.1)", border:"1px solid rgba(244,63,94,0.25)" }}>
              {error === "cancelled" ? "Sign-in was cancelled." :
               error === "expired"   ? "Session expired. Please try again." :
               error === "auth_failed" ? "Authentication failed. Please try again." :
               `Error: ${error}`}
            </div>
          )}

          {/* CTA */}
          <div style={{ animation:"fade-up 0.5s 0.28s both" }}>
            <button
              onClick={handleMicrosoftLogin}
              disabled={msLoading}
              data-testid="button-microsoft-login"
              className="group relative w-full overflow-hidden flex items-center gap-4 px-6 py-4 rounded-2xl text-white font-semibold transition-all duration-300 hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background:"linear-gradient(135deg,#7c3aed 0%,#6d28d9 50%,#4f46e5 100%)",
                boxShadow:"0 12px 40px rgba(124,58,237,0.45)",
              }}>
              {/* shimmer sweep */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                style={{ background:"linear-gradient(105deg,transparent 30%,rgba(255,255,255,0.12) 50%,transparent 70%)",
                  backgroundSize:"400% 100%", animation:"shimmer 1.8s ease infinite" }} />

              {msLoading
                ? <div className="w-5 h-5 border-2 border-white/25 border-t-white rounded-full shrink-0"
                    style={{ animation:"spin 0.7s linear infinite" }} />
                : <svg viewBox="0 0 23 23" className="w-5 h-5 shrink-0" fill="none">
                    <path fill="#f35325" d="M1 1h10v10H1z"/>
                    <path fill="#81bc06" d="M12 1h10v10H12z"/>
                    <path fill="#05a6f0" d="M1 12h10v10H1z"/>
                    <path fill="#ffba08" d="M12 12h10v10H12z"/>
                  </svg>
              }
              <div className="text-left flex-1">
                <p className="text-sm font-bold">{msLoading ? "Preparing sign-in…" : "Continue with Microsoft"}</p>
                <p className="text-xs text-white/55 font-normal mt-0.5">Personal or work account</p>
              </div>
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-white/50 group-hover:text-white group-hover:translate-x-1 transition-all duration-200 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M9 18l6-6-6-6"/>
              </svg>
            </button>
          </div>

          <p className="text-[11px] text-center text-white/22 mt-6"
            style={{ animation:"fade-up 0.5s 0.38s both" }}>
            By signing in you agree to our{" "}
            <span className="text-white/45 underline underline-offset-2 cursor-pointer hover:text-white/70 transition-colors">Terms</span>
            {" "}and{" "}
            <span className="text-white/45 underline underline-offset-2 cursor-pointer hover:text-white/70 transition-colors">Privacy Policy</span>
          </p>
        </div>
      </div>
    </div>
  );
}
