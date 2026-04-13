import { useState, useEffect, useRef } from "react";
import { Lock, LockOpen, ShieldCheck, ShieldOff, Loader2, X, KeyRound, Mail, RefreshCw } from "lucide-react";
import { API_BASE } from "@/lib/api";

export default function ArchiveLockGate({ children, renderHeaderAction }: {
  children: (manageLockBtn: React.ReactNode) => React.ReactNode;
  renderHeaderAction?: never;
}) {
  const [locked, setLocked]             = useState<boolean | null>(null); // null = loading
  const [sessionOk, setSessionOk]       = useState(false);

  // Enter-code screen
  const [code, setCode]                 = useState("");
  const [unlockError, setUnlockError]   = useState("");
  const [unlocking, setUnlocking]       = useState(false);

  // Recovery via email
  const [showRecovery, setShowRecovery]       = useState(false);
  const [recoveryStep, setRecoveryStep]       = useState<"idle" | "sending" | "sent" | "choose" | "newqr-loading" | "newqr">("idle");
  const [maskedEmail, setMaskedEmail]         = useState("");
  const [recoveryCode, setRecoveryCode]       = useState("");
  const [recoveryError, setRecoveryError]     = useState("");
  const [verifyingRecovery, setVerifyingRec]  = useState(false);
  const [recoveryNewQr, setRecoveryNewQr]     = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [recoveryNewCode, setRecoveryNewCode] = useState("");
  const [recoveryNewError, setRecoveryNewError] = useState("");
  const [confirmingNewQr, setConfirmingNewQr] = useState(false);

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

  // Re-setup after recovery
  const [recoveredSession, setRecoveredSession]     = useState(false);
  const [manageLockView, setManageLockView]         = useState<"menu" | "remove" | "reset-verify" | "reset-qr">("menu");
  const [resetVerifyCode, setResetVerifyCode]       = useState("");
  const [resetVerifyError, setResetVerifyError]     = useState("");
  const [resetQrData, setResetQrData]               = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [resetConfirmCode, setResetConfirmCode]     = useState("");
  const [resetConfirmError, setResetConfirmError]   = useState("");
  const [resetLoading, setResetLoading]             = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchStatus = async () => {
    setLocked(null);
    try {
      const [ls, ss] = await Promise.all([
        fetch(`${API_BASE}/archive-lock/status`, { credentials: "include" }).then(r => r.json() as Promise<{ locked: boolean }>),
        fetch(`${API_BASE}/archive-lock/session`, { credentials: "include" }).then(r => r.json() as Promise<{ unlocked: boolean; recoveredViaEmail: boolean }>),
      ]);
      setLocked(ls.locked);
      setSessionOk(ss.unlocked);
      setRecoveredSession(ss.recoveredViaEmail ?? false);
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
      if (data.success) { setRecoveryStep("choose"); setRecoveryCode(""); }
      else { setRecoveryError(data.error ?? "Invalid code"); setRecoveryCode(""); }
    } catch { setRecoveryError("Network error"); }
    finally { setVerifyingRec(false); }
  };

  const pickKeepExisting = () => {
    setSessionOk(true);
    setShowRecovery(false);
    setRecoveredSession(true); // mark that identity was proved via email, not TOTP
  };

  const pickSetupNew = async () => {
    setRecoveryStep("newqr-loading");
    try {
      await fetch(`${API_BASE}/archive-lock/setup`, { method: "DELETE", credentials: "include" });
      const res = await fetch(`${API_BASE}/archive-lock/setup`, { method: "POST", credentials: "include" });
      const data = await res.json() as { qrDataUrl: string; secret: string };
      setRecoveryNewQr(data);
      setRecoveryNewCode("");
      setRecoveryNewError("");
      setRecoveryStep("newqr");
    } catch {
      setRecoveryError("Failed to generate QR. Please try again.");
      setRecoveryStep("choose");
    }
  };

  const confirmNewQr = async () => {
    if (recoveryNewCode.length !== 6) return;
    setConfirmingNewQr(true); setRecoveryNewError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: recoveryNewCode }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setSessionOk(true); setLocked(true);
        setShowRecovery(false);
        setRecoveryNewQr(null); setRecoveryNewCode("");
      } else { setRecoveryNewError(data.error ?? "Invalid code"); setRecoveryNewCode(""); }
    } catch { setRecoveryNewError("Network error"); }
    finally { setConfirmingNewQr(false); }
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
      setManageLockView("menu"); setLocked(false); setSessionOk(false);
    } catch { setRemoveError("Network error"); }
    finally { setRemoving(false); }
  };

  // Used when user got in via email recovery — no TOTP needed, identity already proven
  const handleRemoveLockDirect = async () => {
    setRemoving(true); setRemoveError("");
    try {
      await fetch(`${API_BASE}/archive-lock/setup`, { method: "DELETE", credentials: "include" });
      setShowRemove(false); setRemoveCode(""); setRemoveError("");
      setManageLockView("menu"); setLocked(false); setSessionOk(false); setRecoveredSession(false);
    } catch { setRemoveError("Network error"); }
    finally { setRemoving(false); }
  };

  const doResetSetup = async (verifiedToken?: string) => {
    setResetLoading(true); setResetVerifyError("");
    try {
      if (!recoveredSession && verifiedToken) {
        const vRes = await fetch(`${API_BASE}/archive-lock/verify`, {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ token: verifiedToken }),
        });
        const vData = await vRes.json() as { success?: boolean; error?: string };
        if (!vData.success) { setResetVerifyError(vData.error ?? "Invalid code"); setResetLoading(false); return; }
      }
      await fetch(`${API_BASE}/archive-lock/setup`, { method: "DELETE", credentials: "include" });
      const res = await fetch(`${API_BASE}/archive-lock/setup`, { method: "POST", credentials: "include" });
      const data = await res.json() as { qrDataUrl: string; secret: string };
      setResetQrData(data);
      setResetVerifyCode("");
      setManageLockView("reset-qr");
    } catch { setResetVerifyError("Network error"); }
    finally { setResetLoading(false); }
  };

  const confirmResetSetup = async () => {
    if (resetConfirmCode.length !== 6) return;
    setResetLoading(true); setResetConfirmError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({ token: resetConfirmCode }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setShowRemove(false); setManageLockView("menu");
        setResetQrData(null); setResetConfirmCode(""); setResetConfirmError("");
        setRecoveredSession(false); setLocked(true); setSessionOk(true);
      } else { setResetConfirmError(data.error ?? "Invalid code"); setResetConfirmCode(""); }
    } catch { setResetConfirmError("Network error"); }
    finally { setResetLoading(false); }
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
                {recoveryStep === "choose" || recoveryStep === "newqr" || recoveryStep === "newqr-loading"
                  ? <RefreshCw className="w-4 h-4 text-primary" />
                  : <Mail className="w-4 h-4 text-primary" />}
                <h2 className="text-sm font-semibold">
                  {recoveryStep === "choose" ? "Recovery successful"
                    : recoveryStep === "newqr" || recoveryStep === "newqr-loading" ? "Set up new authenticator"
                    : "Email Recovery"}
                </h2>
              </div>
              <button onClick={() => setShowRecovery(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step 1 — request email */}
            {recoveryStep === "idle" && (
              <>
                <p className="text-xs text-muted-foreground">We'll send a one-time 6-digit code to your account email to verify it's you.</p>
                {recoveryError && <p className="text-xs text-destructive">{recoveryError}</p>}
                <button
                  onClick={sendRecoveryEmail}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  <Mail className="w-4 h-4" /> Send recovery code
                </button>
              </>
            )}

            {/* Step 1b — sending spinner */}
            {recoveryStep === "sending" && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Sending…</span>
              </div>
            )}

            {/* Step 2 — enter email OTP */}
            {recoveryStep === "sent" && (
              <>
                <p className="text-xs text-muted-foreground">Code sent to <strong>{maskedEmail}</strong>. Enter it below (valid 10 min).</p>
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
                  {verifyingRecovery ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Verify email code
                </button>
                <button
                  onClick={() => { setRecoveryStep("idle"); setRecoveryCode(""); setRecoveryError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Resend code
                </button>
              </>
            )}

            {/* Step 3 — choose: set up new authenticator OR keep existing */}
            {recoveryStep === "choose" && (
              <>
                <p className="text-xs text-muted-foreground text-center">Identity verified. What would you like to do next?</p>
                {recoveryError && <p className="text-xs text-destructive">{recoveryError}</p>}
                <button
                  onClick={pickSetupNew}
                  className="flex items-center gap-3 w-full p-3 rounded-xl border border-border hover:bg-muted transition-colors text-left"
                >
                  <RefreshCw className="w-5 h-5 text-primary shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Set up new authenticator</p>
                    <p className="text-xs text-muted-foreground">Scan a fresh QR code in Microsoft Authenticator</p>
                  </div>
                </button>
                <button
                  onClick={pickKeepExisting}
                  className="flex items-center gap-3 w-full p-3 rounded-xl border border-border hover:bg-muted transition-colors text-left"
                >
                  <LockOpen className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Keep existing setup</p>
                    <p className="text-xs text-muted-foreground">Unlock now — your current authenticator entry is preserved</p>
                  </div>
                </button>
              </>
            )}

            {/* Step 3b — generating new QR spinner */}
            {recoveryStep === "newqr-loading" && (
              <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 className="w-5 h-5 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Generating new QR code…</span>
              </div>
            )}

            {/* Step 4 — scan new QR and confirm */}
            {recoveryStep === "newqr" && recoveryNewQr && (
              <>
                <p className="text-xs text-muted-foreground text-center">Scan with Microsoft Authenticator, then enter the 6-digit code to confirm.</p>
                <div className="flex justify-center">
                  <img src={recoveryNewQr.qrDataUrl} alt="New TOTP QR" className="w-40 h-40 rounded-xl border border-border" />
                </div>
                <input
                  type="text" inputMode="numeric" maxLength={6} autoFocus
                  value={recoveryNewCode}
                  onChange={e => { setRecoveryNewCode(e.target.value.replace(/\D/g, "")); setRecoveryNewError(""); }}
                  onKeyDown={e => { if (e.key === "Enter") confirmNewQr(); }}
                  placeholder="000000"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {recoveryNewError && <p className="text-xs text-destructive">{recoveryNewError}</p>}
                <button
                  onClick={confirmNewQr}
                  disabled={recoveryNewCode.length !== 6 || confirmingNewQr}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {confirmingNewQr ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Confirm &amp; unlock
                </button>
                <button
                  onClick={() => setRecoveryStep("choose")}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  ← Back
                </button>
              </>
            )}
          </div>
        </div>
      )}
      </>
    );
  }

  const manageLockBtn = (
    <button
      onClick={() => setShowRemove(true)}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors ${
        recoveredSession
          ? "border-amber-400/50 text-amber-500 hover:text-amber-600 hover:bg-amber-50/10"
          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
      }`}
    >
      {recoveredSession ? <RefreshCw className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
      {recoveredSession ? "Setup new authenticator" : "Manage lock"}
    </button>
  );

  // ── Unlocked: show archive with "Manage lock" button ────────────────────────
  return (
    <>
      {showRemove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-xs p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {manageLockView === "remove" ? <ShieldOff className="w-4 h-4 text-destructive" />
                  : manageLockView === "menu" ? <KeyRound className="w-4 h-4 text-primary" />
                  : <RefreshCw className="w-4 h-4 text-primary" />}
                <h2 className="text-sm font-semibold">
                  {manageLockView === "remove" ? "Remove Archive Lock"
                    : manageLockView === "reset-qr" ? "Set Up New Authenticator"
                    : manageLockView === "reset-verify" ? "Reset Authenticator"
                    : "Manage Archive Lock"}
                </h2>
              </div>
              <button onClick={() => { setShowRemove(false); setRemoveCode(""); setRemoveError(""); setManageLockView("menu"); setResetVerifyCode(""); setResetVerifyError(""); setResetQrData(null); setResetConfirmCode(""); setResetConfirmError(""); }}
                className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Menu view */}
            {manageLockView === "menu" && (
              <div className="flex flex-col gap-3">
                <button
                  onClick={() => setManageLockView("remove")}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted transition-colors text-left"
                >
                  <ShieldOff className="w-5 h-5 text-destructive shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-foreground">Remove Lock</p>
                    <p className="text-xs text-muted-foreground">Disable archive protection entirely</p>
                  </div>
                </button>
                <button
                  onClick={async () => { if (recoveredSession) { await doResetSetup(); } else { setManageLockView("reset-verify"); } }}
                  className="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-muted transition-colors text-left"
                  disabled={resetLoading}
                >
                  {resetLoading ? <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" /> : <RefreshCw className="w-5 h-5 text-primary shrink-0" />}
                  <div>
                    <p className="text-sm font-medium text-foreground">Reset Authenticator</p>
                    <p className="text-xs text-muted-foreground">Set up a new TOTP app for the archive</p>
                  </div>
                </button>
              </div>
            )}

            {/* Remove view */}
            {manageLockView === "remove" && (
              <>
                {recoveredSession ? (
                  // Identity already verified via email — no TOTP needed
                  <>
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50/10 border border-amber-400/30">
                      <Mail className="w-4 h-4 text-amber-500 shrink-0" />
                      <p className="text-xs text-amber-600">You verified your identity via email. No authenticator code needed.</p>
                    </div>
                    {removeError && <p className="text-xs text-destructive">{removeError}</p>}
                    <button
                      onClick={handleRemoveLockDirect} disabled={removing}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                    >
                      {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
                      Confirm remove lock
                    </button>
                  </>
                ) : (
                  // Normal path — verify with TOTP
                  <>
                    <p className="text-xs text-muted-foreground">Enter your current authenticator code to confirm removal.</p>
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
                  </>
                )}
                <button onClick={() => { setManageLockView("menu"); setRemoveCode(""); setRemoveError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors">← Back</button>
              </>
            )}

            {/* Reset — verify current TOTP first (skipped if recovered session) */}
            {manageLockView === "reset-verify" && (
              <>
                <p className="text-xs text-muted-foreground">Enter your current authenticator code to proceed.</p>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  value={resetVerifyCode} onChange={e => { setResetVerifyCode(e.target.value.replace(/\D/g, "")); setResetVerifyError(""); }}
                  placeholder="000000" autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary"
                  onKeyDown={e => { if (e.key === "Enter") doResetSetup(resetVerifyCode); }}
                />
                {resetVerifyError && <p className="text-xs text-destructive">{resetVerifyError}</p>}
                <button
                  onClick={() => doResetSetup(resetVerifyCode)} disabled={resetVerifyCode.length !== 6 || resetLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Continue
                </button>
                <button onClick={() => { setManageLockView("menu"); setResetVerifyCode(""); setResetVerifyError(""); }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground transition-colors">← Back</button>
              </>
            )}

            {/* Reset — scan new QR and confirm */}
            {manageLockView === "reset-qr" && resetQrData && (
              <>
                <p className="text-xs text-muted-foreground text-center">Scan with Microsoft Authenticator, then enter the 6-digit code to confirm.</p>
                <div className="flex justify-center">
                  <img src={resetQrData.qrDataUrl} alt="New TOTP QR code" className="w-40 h-40 rounded-xl border border-border" />
                </div>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  value={resetConfirmCode} onChange={e => { setResetConfirmCode(e.target.value.replace(/\D/g, "")); setResetConfirmError(""); }}
                  placeholder="000000" autoFocus
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-primary"
                  onKeyDown={e => { if (e.key === "Enter") confirmResetSetup(); }}
                />
                {resetConfirmError && <p className="text-xs text-destructive">{resetConfirmError}</p>}
                <button
                  onClick={confirmResetSetup} disabled={resetConfirmCode.length !== 6 || resetLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {resetLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Confirm new authenticator
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col h-full">
        {children(manageLockBtn)}
      </div>
    </>
  );
}
