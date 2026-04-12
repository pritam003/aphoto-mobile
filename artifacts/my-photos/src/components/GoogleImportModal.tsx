import { useState, useEffect, useRef } from "react";
import { X, CheckCircle, AlertCircle, Loader2, FolderDown } from "lucide-react";
import { useLocation } from "wouter";
import { API_BASE } from "@/lib/api";

interface GoogleImportModalProps {
  onClose: () => void;
  activeImportId?: string | null;
}

interface ImportStatus {
  status: "running" | "done" | "error";
  albumName: string;
  albumId?: string;
  total: number;
  imported: number;
  errors: number;
  message?: string;
}

export default function GoogleImportModal({ onClose, activeImportId }: GoogleImportModalProps) {
  const [, navigate] = useLocation();
  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState("");
  const [importId, setImportId] = useState<string | null>(activeImportId ?? null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll import status while running
  useEffect(() => {
    if (!importId) return;

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
      } catch {/* keep polling on network hiccup */}
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [importId]);

  const handleStartImport = async () => {
    setUrlError("");
    if (!url.trim()) { setUrlError("Paste a Google Photos album link first."); return; }

    setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/google/auth-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ albumUrl: url.trim() }),
      });
      const data = await res.json() as { authUrl?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        setUrlError(data.error ?? "Failed to start import.");
        return;
      }
      // Redirect browser to Google OAuth consent screen
      window.location.href = data.authUrl;
    } catch {
      setUrlError("Network error — please try again.");
    } finally {
      setStarting(false);
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
            <FolderDown className="w-5 h-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">Import from Google Photos</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* URL input — shown until import starts */}
          {!importId && (
            <>
              <p className="text-sm text-muted-foreground">
                Paste any Google Photos album link — yours or shared with you.
                You'll be asked to sign in with Google to authorize the import.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground">Album URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={e => { setUrl(e.target.value); setUrlError(""); }}
                  placeholder="https://photos.app.goo.gl/..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  onKeyDown={e => e.key === "Enter" && handleStartImport()}
                />
                {urlError && <p className="text-xs text-destructive">{urlError}</p>}
              </div>
              <div className="text-xs text-muted-foreground bg-muted/40 rounded-lg p-3 space-y-1">
                <p className="font-medium text-foreground">Supported URL formats:</p>
                <p><code className="font-mono">photos.app.goo.gl/...</code></p>
                <p><code className="font-mono">photos.google.com/album/...</code></p>
                <p><code className="font-mono">photos.google.com/share/...</code></p>
              </div>
              <button
                onClick={handleStartImport}
                disabled={starting || !url.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {starting ? <><Loader2 className="w-4 h-4 animate-spin" /> Redirecting…</> : "Continue with Google"}
              </button>
            </>
          )}

          {/* Progress — shown while import is running or done */}
          {importId && (
            <div className="space-y-4">
              {!importStatus && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Starting import…</p>
                </div>
              )}

              {importStatus && (
                <>
                  <div className="flex items-start gap-3">
                    {importStatus.status === "running" && <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0 mt-0.5" />}
                    {importStatus.status === "done"    && <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />}
                    {importStatus.status === "error"   && <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{importStatus.albumName}</p>
                      {importStatus.status === "running" && (
                        <p className="text-xs text-muted-foreground">
                          {importStatus.imported + importStatus.errors} / {importStatus.total} photos processed
                        </p>
                      )}
                      {importStatus.status === "done" && (
                        <p className="text-xs text-muted-foreground">
                          {importStatus.imported} imported{importStatus.errors > 0 ? `, ${importStatus.errors} skipped` : ""}
                        </p>
                      )}
                      {importStatus.status === "error" && (
                        <p className="text-xs text-destructive">{importStatus.message}</p>
                      )}
                    </div>
                  </div>

                  {importStatus.total > 0 && (
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          importStatus.status === "error" ? "bg-destructive" :
                          importStatus.status === "done"  ? "bg-green-500" : "bg-primary"
                        }`}
                        style={{ width: `${importStatus.status === "done" ? 100 : pct}%` }}
                      />
                    </div>
                  )}

                  {importStatus.status === "done" && importStatus.albumId && (
                    <button
                      onClick={() => { onClose(); navigate(`/albums/${importStatus.albumId}`); }}
                      className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
                    >
                      View imported album
                    </button>
                  )}

                  {importStatus.status === "error" && (
                    <button
                      onClick={() => { setImportId(null); setImportStatus(null); setUrl(""); }}
                      className="w-full py-2 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                    >
                      Try again
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
