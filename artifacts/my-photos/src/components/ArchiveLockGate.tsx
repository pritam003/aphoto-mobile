import { useState, useEffect, useRef } from "react";
import { Lock, LockOpen, ShieldCheck, ShieldOff, Loader2, X, KeyRound, Mail } from "lucide-react";
import { API_BASE } from "@/lib/api";

export default function ArchiveLockGate({ children }: { children: React.ReactNode }) {
  const [locked, setLocked]             = useState<boolean | null>(null); // null = loading
  const [sessionOk, setSessionOk]       = useState(false);

  // Enter-code screen
  const [code, setCode]                 = useState("");
  const [unlockError, setUnlockError]   = useState("");
  const [unlocking, setUnlocking]       = useState(false);

  // Recovery via email
  const [showRecovery, setShowRecovery]       = useState(false);
  const [recoveryStep, setRecoveryStep]       = useState<"idle" | "sending" | "sent">("idle");
  const [maskedEmail, setMaskedEmail]         = useState("");
  const [recoveryCode, setRecoveryCode]       = useState("");
  const [recoveryError, setRecoveryError]     = useState("");
  const [verifyingRecovery, setVerifyingRec]  = useState(false);

  // First-time setup
  const [setupData, setSetupData]       = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [setupCode, setSetupCode]       = useState("");
  const [setupError, setSetupError]     = useState("");
  const [setupLoading, setSetupLoading] = useState(false);

  // Remove lock (when already unlocked)
  const [showRemove, setShowRemove]     = useState(false);
  const [removeCode, setRemoveCode]     = useState("");
  const [removeError, setRemoveError]   = useState("");
  const [removing, setRemoving]         = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchStatus = async () => {
    setLocked(null);
    try {
      const [ls, ss] = await Promise.all([
        fetch(`${API_BASE}/archive-lock/status`, { credentials: "include" }).then(r => r.json() as Promise<{ locked: boolean }>),
        fetch(`${API_BASE}/archive-lock/session`, { credentials: "include" }).then(r => r.json() as Promise<{ unlocked: boolean }>),
      ]);
      setLocked(ls.locked);
      setSessionOk(ss.unlocked);
    } catch {
      setLocked(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  // Auto-focus PIN input whenever the code-entry screen is shown
  useEffect(() => {
    if (locked && !sessionOk && locked !== null) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [locked, sessionOk]);

  const startSetup = async () => {
    setSetupLoading(true); setSetupError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/setup`, { method: "POST", credentials: "include" });
      const data = await res.json() as { qrDataUrl: string; secret: string };
      setSetupData(data);
    } catch { setSetupError("Failed to generate QR code. Please try again."); }
    finally { setSetupLoading(false); }
  };

  const confirmSetup = async () => {
    if (setupCode.length !== 6) return;
    setSetupLoading(true); setSetupError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: setupCode }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) { setSetupData(null); setSetupCode(""); setLocked(true); setSessionOk(true); }
      else setSetupError(data.error ?? "Invalid code — please try again");
    } catch { setSetupError("Network error"); }
    finally { setSetupLoading(false); }
  };

  const handleUnlock = async () => {
    if (code.length !== 6) return;
    setUnlocking(true); setUnlockError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: code }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) { setSessionOk(true); setCode(""); }
      else { setUnlockError(data.error ?? "Invalid code"); setCode(""); }
    } catch { setUnlockError("Network error"); }
    finally { setUnlocking(false); }
  };

  const sendRecoveryEmail = async () => {
    setRecoveryStep("sending"); setRecoveryError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/send-recovery`, {
        method: "POST", credentials: "include",
      });
      const data = await res.json() as { sent?: boolean; maskedEmail?: string; error?: string };
      if (data.sent) { setRecoveryStep("sent"); setMaskedEmail(data.maskedEmail ?? "your email"); }
      else { setRecoveryStep("idle"); setRecoveryError(data.error ?? "Failed to send email"); }
    } catch { setRecoveryStep("idle"); setRecoveryError("Network error"); }
  };

  const verifyRecoveryCode = async () => {
    if (recoveryCode.length !== 6) return;
    setVerifyingRec(true); setRecoveryError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/verify-recovery`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: recoveryCode }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) { setSessionOk(true); setShowRecovery(false); }
      else { setRecoveryError(data.error ?? "Invalid code"); setRecoveryCode(""); }
    } catch { setRecoveryError("Network error"); }
    finally { setVerifyingRec(false); }
  };

  const handleRemoveLock = async () => {
    if (removeCode.length !== 6) return;
    setRemoving(true); setRemoveError("");
    try {
      const vRes = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: removeCode }),
      });
      const vData = await vRes.json() as { success?: boolean; error?: string };
      if (!vData.success) { setRemoveError(vData.error ?? "Invalid code"); setRemoving(false); return; }
      await fetch(`${API_BASE}/archive-lock/setup`, { method: "DELETE", credentials: "include" });
      setShowRemove(false); setRemoveCode(""); setRemoveError("");
      setLocked(false); setSessionOk(false);
    } catch { setRemoveError("Network error"); }
    finally { setRemoving(false); }
  };

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (locked === null) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── No lock yet: must set one up before entering ─────────────────────────────
  if (!locked) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-sm p-6 space-y-5">

          {/* Step 1: explain & generate QR */}
          {!setupData && (
            <>
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                  <Lock className="w-7 h-7 text-primary" />
                </div>
                <h2 className="text-base font-semibold text-foreground">Archive is protected</h2>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  You need to set up a lock before accessing the Archive.<br />
                  Use <strong>Microsoft Authenticator</strong> (or any TOTP app) for the 6-digit code.
                </p>
              </div>
              {setupError && <p className="text-xs text-destructive text-center">{setupError}</p>}
              <button
                onClick={startSetup} disabled={setupLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                Set up lock
              </button>
            </>
          )}

          {/* Step 2: show QR + confirm code */}
          {setupData && (
            <>
              <div className="flex flex-col items-center gap-2 text-center">
                <ShieldCheck className="w-6 h-6 text-primary" />
                <h2 className="text-sm font-semibold text-foreground">Scan with Microsoft Authenticator</h2>
                <p className="text-xs text-muted-foreground">Then enter the 6-digit code below to confirm.</p>
              </div>
              <div className="flex justify-center">
                <img src={setupData.qrDataUrl} alt="TOTP QR code" className="w-44 h-44 rounded-xl border border-border" />
              </div>
              <input
                type="text" inputMode="numeric" maxLength={6}
                value={setupCode} onChange={e => setSetupCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000" autoFocus
                className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary"
                onKeyDown={e => { if (e.key === "Enter") confirmSetup(); }}
              />
              {setupError && <p className="text-xs text-destructive text-center">{setupError}</p>}
              <button
                onClick={confirmSetup} disabled={setupCode.length !== 6 || setupLoading}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}
                Confirm &amp; unlock
              </button>
              <button onClick={() => { setSetupData(null); setSetupCode(""); setSetupError(""); }}
                className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors">
                ← Back
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Lock exists, session not unlocked: PIN screen ────────────────────────────
  if (!sessionOk) {
    return (
      <>
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-xs p-6 space-y-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Archive is locked</h2>
            <p className="text-xs text-muted-foreground">Enter the 6-digit code from Microsoft Authenticator</p>
          </div>

          {/* Visual digit boxes */}
          <div
            className="flex gap-2 justify-center cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={`w-9 h-11 rounded-lg border text-base font-semibold flex items-center justify-center
                ${code.length === i ? "border-primary bg-primary/5 ring-1 ring-primary" : "border-border bg-muted"} text-foreground`}>
                {code[i] ? "•" : ""}
              </div>
            ))}
          </div>

          {/* Hidden real input captures keyboard */}
          <input
            ref={inputRef}
            type="text" inputMode="numeric" maxLength={6}
            value={code}
            onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setUnlockError(""); }}
            onKeyDown={e => { if (e.key === "Enter") handleUnlock(); }}
            className="sr-only" aria-label="6-digit authenticator code"
          />

          {unlockError && <p className="text-xs text-destructive text-center">{unlockError}</p>}

          <button
            onClick={handleUnlock} disabled={code.length !== 6 || unlocking}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}
            Unlock
          </button>

          {/* Number pad */}
          <div className="grid grid-cols-3 gap-2">
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k) => (
              <button key={k} disabled={!k}
                onClick={() => {
                  if (k === "⌫") { setCode(c => c.slice(0, -1)); }
                  else if (k && code.length < 6) { setCode(c => c + k); }
                  setUnlockError("");
                }}
                className={`h-11 rounded-lg text-sm font-medium transition-colors
                  ${k ? "bg-muted hover:bg-muted/70 active:scale-95 text-foreground" : "invisible"}
                  ${k === "⌫" ? "text-destructive" : ""}`}
              >
                {k}
              </button>
            ))}
          </div>

          {/* Recovery link */}
          <button
            onClick={() => { setShowRecovery(true); setRecoveryStep("idle"); setRecoveryCode(""); setRecoveryError(""); }}
            className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors pt-1"
          >
            Lost access to authenticator? Recover via email →
          </button>
        </div>
      </div>

      {/* Recovery modal */}
      {showRecovery && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xs p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                <h2 className="text-sm font-semibold">Email Recovery</h2>
              </div>
              <button onClick={() => setShowRecovery(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {recoveryStep === "idle" && (
              <>
                <p className="text-xs text-muted-foreground">We'll send a one-time 6-digit code to your account email. Enter it here to unlock.</p>
                {recoveryError && <p className="text-xs text-destructive">{recoveryError}</p>}
                <button
                  onClick={sendRecoveryEmail}
                  disabled={recoveryStep !== "idle"}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Mail className="w-4 h-4" /> Send recovery code
                </button>
              </>
            )}

            {recoveryStep === "sending" && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Sending…</span>
              </div>
            )}

            {recoveryStep === "sent" && (
              <>
                <p className="text-xs text-muted-foreground">Code sent to <strong>{maskedEmail}</strong>. Check your inbox (valid 10 min).</p>
                <input
                  type="text" inputMode="numeric" maxLength={6} autoFocus
                  value={recoveryCode}
                  onChange={e => { setRecoveryCode(e.target.value.replace(/\D/g, "")); setRecoveryError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") verifyRecoveryCode(); }}
                  placeholder="000000"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {recoveryError && <p className="text-xs text-destructive">{recoveryError}</p>}
                <button
                  onClick={verifyRecoveryCode}
                  disabled={recoveryCode.length !== 6 || verifyingRecovery}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {verifyingRecovery ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}
                  Unlock with email code
                </button>
                <button
                  onClick={() => { setRecoveryStep("idle"); setRecoveryCode(""); setRecoveryError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Resend code
                </button>
              </>
            )}
          </div>
        </div>
      )}
      </>
    );
  }

  // ── Unlocked: show archive with "Manage lock" button ────────────────────────
  return (
    <>
      {showRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xs p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShieldOff className="w-4 h-4 text-destructive" />
                <h2 className="text-sm font-semibold">Remove Archive Lock</h2>
              </div>
              <button onClick={() => { setShowRemove(false); setRemoveCode(""); setRemoveError(""); }}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Enter your current authenticator code to confirm.</p>
            <input
              type="text" inputMode="numeric" maxLength={6}
              value={removeCode} onChange={e => setRemoveCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000" autoFocus
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-destructive"
              onKeyDown={e => { if (e.key === "Enter") handleRemoveLock(); }}
            />
            {removeError && <p className="text-xs text-destructive">{removeError}</p>}
            <button
              onClick={handleRemoveLock} disabled={removeCode.length !== 6 || removing}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            >
              {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
              Remove lock
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col h-full relative">
        <div className="absolute top-3 right-4 z-20">
          <button onClick={() => setShowRemove(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <KeyRound className="w-3.5 h-3.5" /> Manage lock
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
