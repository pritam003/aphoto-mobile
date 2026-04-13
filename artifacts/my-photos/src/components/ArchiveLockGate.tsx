import { useState, useEffect, useRef } from "react";
import { Lock, LockOpen, ShieldCheck, ShieldOff, Loader2, X, KeyRound } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface LockStatus {
  locked: boolean;
}
interface SessionStatus {
  unlocked: boolean;
}

export default function ArchiveLockGate({ children }: { children: React.ReactNode }) {
  const [lockStatus, setLockStatus]     = useState<LockStatus | null>(null);
  const [sessionOk, setSessionOk]       = useState(false);
  const [loading, setLoading]           = useState(true);

  // Unlock screen
  const [code, setCode]                 = useState("");
  const [unlockError, setUnlockError]   = useState("");
  const [unlocking, setUnlocking]       = useState(false);

  // Setup flow
  const [showSetup, setShowSetup]       = useState(false);
  const [setupData, setSetupData]       = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [setupCode, setSetupCode]       = useState("");
  const [setupError, setSetupError]     = useState("");
  const [setupLoading, setSetupLoading] = useState(false);
  const [showRemove, setShowRemove]     = useState(false);
  const [removeCode, setRemoveCode]     = useState("");
  const [removeError, setRemoveError]   = useState("");
  const [removing, setRemoving]         = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const [ls, ss] = await Promise.all([
        fetch(`${API_BASE}/archive-lock/status`, { credentials: "include" }).then(r => r.json() as Promise<LockStatus>),
        fetch(`${API_BASE}/archive-lock/session`, { credentials: "include" }).then(r => r.json() as Promise<SessionStatus>),
      ]);
      setLockStatus(ls);
      setSessionOk(ss.unlocked);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStatus(); }, []);

  useEffect(() => {
    if (lockStatus?.locked && !sessionOk && !loading) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [lockStatus, sessionOk, loading]);

  const handleUnlock = async () => {
    if (code.length !== 6) return;
    setUnlocking(true); setUnlockError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: code }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) { setSessionOk(true); setCode(""); }
      else setUnlockError(data.error ?? "Invalid code");
    } catch { setUnlockError("Network error"); }
    finally { setUnlocking(false); }
  };

  const startSetup = async () => {
    setSetupLoading(true); setSetupError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/setup`, { method: "POST", credentials: "include" });
      const data = await res.json() as { qrDataUrl: string; secret: string };
      setSetupData(data); setShowSetup(true);
    } catch { setSetupError("Failed to generate QR code"); }
    finally { setSetupLoading(false); }
  };

  const confirmSetup = async () => {
    if (setupCode.length !== 6) return;
    setSetupLoading(true); setSetupError("");
    try {
      const res = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: setupCode }),
      });
      const data = await res.json() as { success?: boolean; error?: string };
      if (data.success) {
        setShowSetup(false); setSetupData(null); setSetupCode("");
        await fetchStatus();
        setSessionOk(true);
      } else {
        setSetupError(data.error ?? "Invalid code — scan the QR code again");
      }
    } catch { setSetupError("Network error"); }
    finally { setSetupLoading(false); }
  };

  const handleRemoveLock = async () => {
    if (removeCode.length !== 6) return;
    setRemoving(true); setRemoveError("");
    try {
      // First verify the TOTP so removal is authenticated
      const verifyRes = await fetch(`${API_BASE}/archive-lock/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token: removeCode }),
      });
      const verifyData = await verifyRes.json() as { success?: boolean; error?: string };
      if (!verifyData.success) { setRemoveError(verifyData.error ?? "Invalid code"); setRemoving(false); return; }

      await fetch(`${API_BASE}/archive-lock/setup`, { method: "DELETE", credentials: "include" });
      setShowRemove(false); setRemoveCode(""); setRemoveError("");
      await fetchStatus(); setSessionOk(false);
    } catch { setRemoveError("Network error"); }
    finally { setRemoving(false); }
  };

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  /* ── Lock not set up: show Archive with a "Set up lock" button in top bar ── */
  if (!lockStatus?.locked) {
    return (
      <>
        {/* Setup QR modal */}
        {showSetup && setupData && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm">
              <div className="flex items-center justify-between px-5 py-4 border-b border-border">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-primary" />
                  <h2 className="text-sm font-semibold">Set up Archive Lock</h2>
                </div>
                <button onClick={() => setShowSetup(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Scan this QR code with <strong>Microsoft Authenticator</strong> (or any TOTP app), then enter the 6-digit code to confirm.
                </p>
                <div className="flex justify-center">
                  <img src={setupData.qrDataUrl} alt="TOTP QR code" className="w-48 h-48 rounded-lg border border-border" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">Confirm code from app</label>
                  <input
                    type="text" inputMode="numeric" maxLength={6}
                    value={setupCode} onChange={e => setSetupCode(e.target.value.replace(/\D/g, ""))}
                    placeholder="000000"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-primary"
                    onKeyDown={e => { if (e.key === "Enter") confirmSetup(); }}
                  />
                </div>
                {setupError && <p className="text-xs text-destructive">{setupError}</p>}
                <button
                  onClick={confirmSetup}
                  disabled={setupCode.length !== 6 || setupLoading}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {setupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Enable lock
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Archive content with "Set up lock" in header — injected via wrapper */}
        <div className="flex-1 flex flex-col h-full">
          {/* Header bar override */}
          <div className="absolute top-0 right-0 p-4 z-20">
            <button
              onClick={startSetup}
              disabled={setupLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {setupLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Lock className="w-3.5 h-3.5" />}
              Set up lock
            </button>
          </div>
          {setupError && !showSetup && <p className="text-xs text-destructive px-6">{setupError}</p>}
          {children}
        </div>
      </>
    );
  }

  /* ── Lock set up but session not unlocked: show PIN screen ── */
  if (!sessionOk) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="bg-card border border-border rounded-2xl shadow-xl w-full max-w-xs p-6 space-y-5">
          <div className="flex flex-col items-center gap-2 text-center">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
              <Lock className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Archive is locked</h2>
            <p className="text-xs text-muted-foreground">Enter the 6-digit code from Microsoft Authenticator</p>
          </div>

          {/* 6-box code input */}
          <div className="flex gap-2 justify-center">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className={`w-9 h-10 rounded-lg border text-base font-semibold flex items-center justify-center
                  ${code.length === i ? "border-primary bg-primary/5" : "border-border bg-muted"}
                  text-foreground`}
              >
                {code[i] ?? ""}
              </div>
            ))}
          </div>
          {/* Hidden real input */}
          <input
            ref={inputRef}
            type="text" inputMode="numeric" maxLength={6}
            value={code}
            onChange={e => { setCode(e.target.value.replace(/\D/g, "")); setUnlockError(""); }}
            onKeyDown={e => { if (e.key === "Enter") handleUnlock(); }}
            className="sr-only"
            aria-label="6-digit authenticator code"
          />
          {/* Tap the boxes area to focus hidden input */}
          <button
            type="button"
            className="absolute inset-0 w-full h-full opacity-0 cursor-text"
            onClick={() => inputRef.current?.focus()}
            aria-hidden
          />

          {unlockError && <p className="text-xs text-destructive text-center">{unlockError}</p>}

          <button
            onClick={handleUnlock}
            disabled={code.length !== 6 || unlocking}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {unlocking ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />}
            Unlock
          </button>

          {/* Numeric pad */}
          <div className="grid grid-cols-3 gap-2">
            {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k) => (
              <button
                key={k}
                disabled={!k}
                onClick={() => {
                  if (k === "⌫") setCode(c => c.slice(0,-1));
                  else if (k && code.length < 6) setCode(c => c + k);
                  setUnlockError("");
                }}
                className={`h-10 rounded-lg text-sm font-medium transition-colors
                  ${k ? "bg-muted hover:bg-muted/70 text-foreground" : "invisible"}
                  ${k === "⌫" ? "text-destructive" : ""}`}
              >
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Unlocked: show archive content with remove-lock button ── */
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
              <button onClick={() => { setShowRemove(false); setRemoveCode(""); setRemoveError(""); }} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-muted-foreground">Enter current authenticator code to confirm removal.</p>
            <input
              type="text" inputMode="numeric" maxLength={6}
              value={removeCode} onChange={e => setRemoveCode(e.target.value.replace(/\D/g, ""))}
              placeholder="000000"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-destructive"
              onKeyDown={e => { if (e.key === "Enter") handleRemoveLock(); }}
              autoFocus
            />
            {removeError && <p className="text-xs text-destructive">{removeError}</p>}
            <button
              onClick={handleRemoveLock}
              disabled={removeCode.length !== 6 || removing}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            >
              {removing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldOff className="w-4 h-4" />}
              Remove lock
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col h-full">
        <div className="absolute top-0 right-0 p-4 z-20">
          <button
            onClick={() => setShowRemove(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <KeyRound className="w-3.5 h-3.5" /> Manage lock
          </button>
        </div>
        {children}
      </div>
    </>
  );
}
