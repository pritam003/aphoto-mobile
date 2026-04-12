import { useState, useEffect, useRef } from "react";
import { X, ExternalLink, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { useLocation } from "wouter";
import { API_BASE } from "@/lib/api";

interface GoogleImportModalProps {
  onClose: () => void;
  /** If set, an import is already in progress (from OAuth callback redirect) */
  activeImportId?: string | null;
}

type ImportStatus =
  | { status: "running"; albumName: string; total: number; imported: number; errors: number }
  | { status: "done"; albumName: string; albumId?: string; total: number; imported: number; errors: number; message?: string }
  | { status: "error"; albumName: string; message: string; total: number; imported: number; errors: number };

export default function GoogleImportModal({ onClose, activeImportId }: GoogleImportModalProps) {
  const [, navigate] = useLocation();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [step, setStep] = useState<"input" | "authorizing" | "importing">(
    activeImportId ? "importing" : "input"
  );
  const [importId, setImportId] = useState<string | null>(activeImportId ?? null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll import status while running
  useEffect(() => {
    if (!importId) return;
    setStep("importing");

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/google/import/${importId}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as ImportStatus;
        setImportStatus(data);
        if (data.status !== "running") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {/* network hiccup — keep polling */}
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [importId]);

  const handleStartImport = async () => {
    setUrlError("");
    if (!url.trim()) { setUrlError("Paste a Google Photos album URL first."); return; }

    setStep("authorizing");
    try {
      const res = await fetch(`${API_BASE}/google/auth-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ albumUrl: url.trim() }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };

      if (!res.ok) {
        if (res.status === 503) setNotConfigured(true);
        setUrlError(data.error ?? "Failed to start import");
        setStep("input");
        return;
      }

      // Open Google OAuth in the same tab — callback will redirect back with ?import_id=
      window.location.href = data.authUrl!;
    } catch {
      setUrlError("Network error — try again.");
      setStep("input");
    }
  };

  const pct = importStatus && importStatus.total > 0
    ? Math.round(((importStatus.imported + importStatus.errors) / importStatus.total) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            {/* Google Photos colour icon */}
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none">
              <path d="M12 12h9.5a9.5 9.5 0 1 1-9.5-9.5V12z" fill="#4285F4"/>
              <path d="M12 12V2.5A9.5 9.5 0 0 1 21.5 12H12z" fill="#34A853"/>
              <path d="M12 12H2.5A9.5 9.5 0 0 1 12 2.5V12z" fill="#FBBC05"/>
              <path d="M12 12v9.5A9.5 9.5 0 0 1 2.5 12H12z" fill="#EA4335"/>
            </svg>
            <h2 className="text-base font-semibold text-foreground">Import from Google Photos</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Not configured warning */}
          {notConfigured && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-600 dark:text-amber-400">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>Google OAuth is not configured on this server. Ask your admin to set <code className="font-mono text-xs">GOOGLE_CLIENT_ID</code> and <code className="font-mono text-xs">GOOGLE_CLIENT_SECRET</code>.</span>
            </div>
          )}

          {/* Step: input */}
          {step === "input" && (
            <>
              <p className="text-sm text-muted-foreground">
                Paste any Google Photos album link you have access to — yours or shared with you.
                You'll be asked to sign in to Google to allow read access.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Album URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={e => { setUrl(e.target.value); setUrlError(""); }}
                  placeholder="https://photos.google.com/album/..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={e => e.key === "Enter" && handleStartImport()}
                />
                {urlError && <p className="text-xs text-destructive">{urlError}</p>}
              </div>
              <div className="text-xs text-muted-foreground space-y-1 bg-muted/40 rounded-lg p-3">
                <p className="font-medium text-foreground">Supported URL formats:</p>
                <p><code className="font-mono">photos.google.com/album/...</code></p>
                <p><code className="font-mono">photos.google.com/share/...</code></p>
              </div>
              <button
                onClick={handleStartImport}
                disabled={!url.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Authorize with Google &amp; Import
              </button>
            </>
          )}

          {/* Step: authorizing (redirect in progress) */}
          {step === "authorizing" && (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <p className="text-sm text-muted-foreground">Redirecting to Google…</p>
            </div>
          )}

          {/* Step: importing (polling) */}
          {step === "importing" && (
            <div className="space-y-4">
              {!importStatus && (
                <div className="flex flex-col items-center gap-3 py-4">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Starting import…</p>
                </div>
              )}

              {importStatus && (
                <>
                  <div className="flex items-start gap-3">
                    {importStatus.status === "running" && <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0 mt-0.5" />}
                    {importStatus.status === "done" && <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />}
                    {importStatus.status === "error" && <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{importStatus.albumName}</p>
                      {importStatus.status === "running" && (
                        <p className="text-xs text-muted-foreground">
                          {importStatus.imported + importStatus.errors} / {importStatus.total} photos processed
                        </p>
                      )}
                      {importStatus.status === "done" && (
                        <p className="text-xs text-muted-foreground">
                          {importStatus.imported} imported{importStatus.errors > 0 ? `, ${importStatus.errors} failed` : ""}
                          {importStatus.message ? ` — ${importStatus.message}` : ""}
                        </p>
                      )}
                      {importStatus.status === "error" && (
                        <p className="text-xs text-destructive">{importStatus.message}</p>
                      )}
                    </div>
                  </div>

                  {importStatus.total > 0 && (
                    <div className="space-y-1">
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            importStatus.status === "error" ? "bg-destructive" :
                            importStatus.status === "done" ? "bg-green-500" : "bg-primary"
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground text-right">{pct}%</p>
                    </div>
                  )}

                  {importStatus.status === "done" && importStatus.albumId && (
                    <button
                      onClick={() => { onClose(); navigate(`/albums/${importStatus.albumId}`); }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      View imported album
                    </button>
                  )}
                  {importStatus.status !== "running" && (
                    <button
                      onClick={onClose}
                      className="w-full px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted transition-colors"
                    >
                      Close
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
