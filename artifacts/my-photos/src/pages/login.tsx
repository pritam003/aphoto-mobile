import { useEffect, useState, useRef } from "react";
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
  @keyframes shutter {
    0%   { transform: scale(1)    rotate(0deg);   filter:drop-shadow(0 8px 24px rgba(139,92,246,0.5)); }
    15%  { transform: scale(0.78) rotate(-8deg);  filter:drop-shadow(0 2px 6px  rgba(139,92,246,0.3)) brightness(0.7); }
    30%  { transform: scale(1.22) rotate(6deg);   filter:drop-shadow(0 12px 32px rgba(255,220,50,0.8)) brightness(1.4); }
    50%  { transform: scale(1.05) rotate(-3deg);  filter:drop-shadow(0 8px 24px rgba(139,92,246,0.6)); }
    70%  { transform: scale(1.0)  rotate(2deg); }
    100% { transform: scale(1)    rotate(0deg);   filter:drop-shadow(0 8px 24px rgba(139,92,246,0.5)); }
  }
  @keyframes flash-in {
    0%   { opacity:0; transform:translateY(6px) scale(0.8); }
    30%  { opacity:1; transform:translateY(-4px) scale(1.12); }
    70%  { opacity:1; transform:translateY(0)   scale(1); }
    100% { opacity:0; transform:translateY(-8px) scale(0.9); }
  }
  @keyframes quote-fade {
    0%   { opacity:0; transform:translateY(6px); }
    20%  { opacity:1; transform:translateY(0); }
    100% { opacity:1; transform:translateY(0); }
  }
  @keyframes camera-idle {
    0%   { transform: scale(1)    rotate(0deg); }
    10%  { transform: scale(1.35) rotate(-4deg); }
    22%  { transform: scale(0.82) rotate(5deg); }
    34%  { transform: scale(1.12) rotate(-2deg); }
    46%  { transform: scale(1.0)  rotate(0deg); }
    100% { transform: scale(1)    rotate(0deg); }
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

const QUOTES = [
  { text: "Life is a collection of moments. Make them beautiful.", author: "— Unknown" },
  { text: "One day or day one. You decide.", author: "— Paulo Coelho" },
  { text: "Happiness is not something ready-made. It comes from your own actions.", author: "— Dalai Lama" },
  { text: "The best thing to hold onto in life is each other.", author: "— Audrey Hepburn" },
  { text: "In every smile there is a memory worth keeping.", author: "— Unknown" },
  { text: "Photography is the story I fail to put into words.", author: "— Destin Sparks" },
  { text: "A photograph is a pause button on life.", author: "— Ty Holland" },
];

export default function LoginPage() {
  const { isAuthenticated, isLoading } = useAuth();
  const [, navigate] = useLocation();

  const [msLoading, setMsLoading] = useState(false);
  const [deviceCode, setDeviceCode] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Camera animation
  const [cameraClicked, setCameraClicked] = useState(false);
  const [showSmile, setShowSmile] = useState(false);
  const [smileText, setSmileText] = useState("Say Cheese! 🧀");
  const smileTexts = ["Say Cheese! 🧀", "Smile! 😄", "Click! 📸", "Perfect! ✨", "Beautiful! 🌟"];
  const smileIdx = useRef(0);
  const [quoteIdx, setQuoteIdx] = useState(() => Math.floor(Math.random() * QUOTES.length));

  // Auto-fire camera click every 3.5s
  useEffect(() => {
    const fire = () => {
      smileIdx.current = (smileIdx.current + 1) % smileTexts.length;
      setSmileText(smileTexts[smileIdx.current]);
      setCameraClicked(true);
      setShowSmile(true);
      setTimeout(() => setShowSmile(false), 1400);
      setTimeout(() => setCameraClicked(false), 700);
    };
    const t = setInterval(fire, 3500);
    // Fire once on mount after a short delay
    const init = setTimeout(fire, 800);
    return () => { clearInterval(t); clearTimeout(init); };
  }, []);

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

  // Rotate quote every 6s
  useEffect(() => {
    const t = setInterval(() => setQuoteIdx(i => (i + 1) % QUOTES.length), 6000);
    return () => clearInterval(t);
  }, []);

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
      {/* Light pastel base — lavender → sky → blush */}
      <div className="absolute inset-0"
        style={{ background: "linear-gradient(145deg,#ede9fe 0%,#e0f2fe 40%,#fce7f3 70%,#f0fdf4 100%)" }} />

      {/* Soft pastel blobs */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute rounded-full"
          style={{ width:700,height:700,top:"-15%",left:"-12%",
            background:"radial-gradient(circle,rgba(167,139,250,0.28) 0%,transparent 65%)",
            animation:"glow-pulse 7s ease-in-out infinite" }} />
        <div className="absolute rounded-full"
          style={{ width:600,height:600,bottom:"-10%",right:"-10%",
            background:"radial-gradient(circle,rgba(251,113,133,0.22) 0%,transparent 65%)",
            animation:"glow-pulse 9s ease-in-out infinite",animationDelay:"3s" }} />
        <div className="absolute rounded-full"
          style={{ width:500,height:500,top:"30%",right:"15%",
            background:"radial-gradient(circle,rgba(56,189,248,0.2) 0%,transparent 65%)",
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
      <div className="absolute inset-0 opacity-[0.12] pointer-events-none"
        style={{ backgroundImage:"linear-gradient(rgba(139,92,246,0.4) 1px,transparent 1px),linear-gradient(90deg,rgba(139,92,246,0.4) 1px,transparent 1px)", backgroundSize:"48px 48px" }} />
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
            background:"rgba(255,255,255,0.82)",
            backdropFilter:"blur(28px)",
            WebkitBackdropFilter:"blur(28px)",
            border:"1px solid rgba(139,92,246,0.15)",
            borderRadius:28,
            padding:"2.5rem",
            boxShadow:"0 24px 64px rgba(139,92,246,0.15), 0 4px 16px rgba(0,0,0,0.06)"
          }}>
            {/* Logo */}
            <div className="flex flex-col items-center gap-2 mb-7">
              <div className="text-5xl" style={{ animation:"soft-float 3s ease-in-out infinite" }}>📸</div>
              <h2 className="text-xl font-bold text-slate-800 tracking-tight">One more step</h2>
              <p className="text-sm text-slate-500">Complete sign-in in your browser</p>
            </div>

            {/* Step 1 */}
            <div className="mb-4" style={{ animation:"fade-up 0.5s 0.1s both" }}>
              <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-2">Step 1 — Copy your code</p>
              <div onClick={handleCopy} className="group cursor-pointer flex flex-col items-center gap-2 rounded-2xl px-5 py-4 transition-all active:scale-95"
                style={{ background:"rgba(139,92,246,0.06)", border:"1px solid rgba(139,92,246,0.15)" }}>
                <span className="font-mono text-2xl font-bold text-slate-800 tracking-[0.25em] w-full text-center">{userCode}</span>
                <span className="flex items-center gap-1.5 text-xs text-slate-400 group-hover:text-violet-600 transition-colors">
                  <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                  {copied ? "✓ Copied!" : "Tap to copy"}
                </span>
              </div>
            </div>

            {/* Step 2 */}
            <div className="mb-5" style={{ animation:"fade-up 0.5s 0.2s both" }}>
              <p className="text-[10px] font-bold text-violet-600 uppercase tracking-widest mb-2">Step 2 — Open link</p>
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

            <div className="flex items-center gap-2 text-xs text-slate-400 mb-5" style={{ animation:"fade-up 0.5s 0.3s both" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 inline-block animate-pulse" />
              Waiting for you to sign in…
            </div>

            <button onClick={() => { setDeviceCode(null); setUserCode(null); setVerificationUri(null); }}
              className="w-full py-2.5 rounded-2xl text-sm text-slate-400 hover:text-slate-600 transition-colors"
              style={{ border:"1px solid rgba(139,92,246,0.15)" }}>
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
          background:"rgba(255,255,255,0.85)",
          backdropFilter:"blur(32px)",
          WebkitBackdropFilter:"blur(32px)",
          border:"1px solid rgba(139,92,246,0.18)",
          borderRadius:32,
          padding:"2.75rem",
          boxShadow:"0 32px 72px rgba(139,92,246,0.18), 0 4px 20px rgba(0,0,0,0.06)"
        }}>

          {/* Hero emoji + title */}
          <div className="flex flex-col items-center gap-3 mb-8">
            {/* Auto-animated camera */}
            <div className="relative flex items-center justify-center select-none">
              <div className="absolute w-24 h-24 rounded-full"
                style={{ background:"radial-gradient(circle,rgba(139,92,246,0.35),transparent 70%)",
                  animation:"glow-pulse 2.8s ease-in-out infinite" }} />
              <span className="relative text-[64px] leading-none"
                style={{
                  animation: cameraClicked
                    ? "shutter 0.65s cubic-bezier(0.36,0.07,0.19,0.97) forwards"
                    : "camera-idle 3.5s ease-in-out infinite",
                  filter:"drop-shadow(0 8px 24px rgba(139,92,246,0.5))",
                  display:"inline-block",
                }}>
                📷
              </span>
              {/* Flash overlay */}
              {cameraClicked && (
                <div className="absolute inset-0 rounded-full pointer-events-none"
                  style={{ background:"rgba(255,255,255,0.7)", animation:"shutter 0.3s ease-out both" }} />
              )}
              {/* "Say Cheese!" pop */}
              {showSmile && (
                <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full text-sm font-bold text-white whitespace-nowrap pointer-events-none"
                  style={{
                    background:"linear-gradient(135deg,#a855f7,#ec4899)",
                    boxShadow:"0 4px 16px rgba(168,85,247,0.5)",
                    animation:"flash-in 1.4s ease-out both",
                  }}>
                  {smileText}
                </div>
              )}
            </div>

            <h1 className="text-[2rem] font-black text-slate-800 tracking-tight leading-none mt-3"
              style={{ animation:"fade-up 0.5s 0.05s both" }}>
              APhoto
            </h1>
            <p className="text-sm text-slate-500 text-center leading-relaxed"
              style={{ animation:"fade-up 0.5s 0.12s both" }}>
              Your memories, beautifully organized
            </p>

            {/* Rotating happiness quote */}
            <div className="mt-2 px-4 py-3 rounded-2xl text-center max-w-xs"
              style={{ background:"rgba(139,92,246,0.06)", border:"1px solid rgba(139,92,246,0.12)" }}>
              <p key={quoteIdx} className="text-xs text-slate-600 italic leading-relaxed"
                style={{ animation:"quote-fade 0.8s ease-out forwards" }}>
                "{QUOTES[quoteIdx].text}"
              </p>
              <p className="text-[10px] text-violet-400 font-medium mt-1">{QUOTES[quoteIdx].author}</p>
            </div>
          </div>

          {/* Feature row */}
          <div className="flex items-center justify-center gap-2 flex-wrap mb-7"
            style={{ animation:"fade-up 0.5s 0.18s both" }}>
            {[["📸","Photos"],["🖼️","Albums"],["❤️","Favorites"],["☁️","Backup"]].map(([icon, label]) => (
              <div key={label} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs text-slate-600 font-medium"
                style={{ background:"rgba(139,92,246,0.07)", border:"1px solid rgba(139,92,246,0.14)" }}>
                <span>{icon}</span>{label}
              </div>
            ))}
          </div>

          {/* Divider */}
          <div className="h-px mb-7" style={{ background:"rgba(139,92,246,0.12)", animation:"fade-up 0.5s 0.22s both" }} />

          {/* Error */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-2xl text-sm text-rose-600"
              style={{ background:"rgba(244,63,94,0.08)", border:"1px solid rgba(244,63,94,0.2)" }}>
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

          <p className="text-[11px] text-center text-slate-400 mt-6"
            style={{ animation:"fade-up 0.5s 0.38s both" }}>
            By signing in you agree to our{" "}
            <span className="text-slate-500 underline underline-offset-2 cursor-pointer hover:text-slate-800 transition-colors">Terms</span>
            {" "}and{" "}
            <span className="text-slate-500 underline underline-offset-2 cursor-pointer hover:text-slate-800 transition-colors">Privacy Policy</span>
          </p>
        </div>
      </div>
    </div>
  );
}
