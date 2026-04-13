import { useState, useEffect, useRef } from "react";
import { X, CheckCircle, AlertCircle, Loader2, FolderDown, ExternalLink, FolderInput } from "lucide-react";
import { useLocation } from "wouter";
import { API_BASE } from "@/lib/api";

interface GoogleImportModalProps {
  onClose: () => void;
  activeImportId?: string | null;
}

interface ImportStatus {
  status: "picking" | "importing" | "done" | "error";
  albumName: string;
  albumId?: string;
  total: number;
  imported: number;
  errors: number;
  message?: string;
  pickerUri?: string;
}

export default function GoogleImportModal({ onClose, activeImportId }: GoogleImportModalProps) {
  const [, navigate] = useLocation();
  const [albumName, setAlbumName] = useState("");
  const [connectError, setConnectError] = useState("");
  const [importId, setImportId] = useState<string | null>(activeImportId ?? null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [starting, setStarting] = useState(false);
  // state token for polling import-by-state while the OAuth tab is open
  const [pendingState, setPendingState] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Phase A: poll for importId by state (after OAuth new-tab opens, before we have an importId)
  useEffect(() => {
    if (!pendingState || importId) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/google/import-by-state/${pendingState}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as { importId?: string; pending?: boolean };
        if (data.importId) {
          setImportId(data.importId);
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {/* keep polling */}
    };
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [pendingState, importId]);

  // Phase B: poll import status once we have an importId
  useEffect(() => {
    if (!importId) return;
    // Clear any phase-A poller
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/google/import/${importId}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as ImportStatus;
        setImportStatus(data);
        // Picker opens in the OAuth tab (redirected there by the server callback);
        // no additional tab needed here.
        if (data.status === "done" || data.status === "error") {
          clearInterval(pollRef.current!);
          pollRef.current = null;
        }
      } catch {/* keep polling */}
    };

    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [importId]);

  const handleConnect = async () => {
    setConnectError("");
    setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/google/auth-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ albumName: albumName.trim() || "Google Photos Import" }),
      });
      const data = await res.json() as { authUrl?: string; state?: string; error?: string };
      if (!res.ok || !data.authUrl) {
        setConnectError(data.error ?? "Failed to connect. Please try again.");
        return;
      }
      // Open Google OAuth in a new tab so the user stays on this modal
      window.open(data.authUrl, "_blank", "noopener,noreferrer");
      // Start polling for importId by state
      setPendingState(data.state!);
    } catch {
      setConnectError("Network error — please try again.");
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
          {/* Step 1 — not yet authenticated / no ongoing import */}
          {!importId && !pendingState && (
            <>
              <p className="text-sm text-muted-foreground">
                Choose a folder name for the imported photos, then sign in with Google to select photos.
              </p>
              {/* Album/folder name input */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <FolderInput className="w-3.5 h-3.5" />
                  Folder name
                </label>
                <input
                  type="text"
                  value={albumName}
                  onChange={e => setAlbumName(e.target.value)}
                  placeholder="e.g. Summer 2021"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  onKeyDown={e => { if (e.key === "Enter" && !starting) handleConnect(); }}
                />
              </div>
              {connectError && <p className="text-xs text-destructive">{connectError}</p>}
              <button
                onClick={handleConnect}
                disabled={starting}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {starting ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening Google sign-in…</> : "Connect Google Photos"}
              </button>
            </>
          )}

          {/* Step 2 — OAuth tab is open, waiting for user to complete sign-in */}
          {pendingState && !importId && (
            <div className="flex flex-col items-center gap-4 py-6">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
              <div className="text-center space-y-1">
                <p className="text-sm font-medium text-foreground">Waiting for Google sign-in…</p>
                <p className="text-xs text-muted-foreground">Complete sign-in in the new tab that just opened.</p>
              </div>
              <button
                onClick={() => { setPendingState(null); setConnectError(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Step 3 — Have importId, show progress */}
          {importId && (
            <div className="space-y-4">
              {!importStatus && (
                <div className="flex flex-col items-center gap-3 py-6">
                  <Loader2 className="w-8 h-8 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">Connecting…</p>
                </div>
              )}

              {/* Picking phase */}
              {importStatus?.status === "picking" && (
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">Waiting for photo selection</p>
                      <p className="text-xs text-muted-foreground">
                        Select your photos in the Google Photos tab, then click Done — the import will start automatically.
                      </p>
                    </div>
                  </div>
                  {importStatus.pickerUri && (
                    <button
                      onClick={() => window.open(importStatus.pickerUri!, "_blank", "noopener,noreferrer")}
                      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-border text-sm font-medium hover:bg-muted transition-colors"
                    >
                      <ExternalLink className="w-4 h-4" />
                      Reopen Google Photos Picker
                    </button>
                  )}
                </div>
              )}

              {importStatus && importStatus.status !== "picking" && (
                <>
                  <div className="flex items-start gap-3">
                    {importStatus.status === "importing" && <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0 mt-0.5" />}
                    {importStatus.status === "done"      && <CheckCircle className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />}
                    {importStatus.status === "error"     && <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{importStatus.albumName}</p>
                      {importStatus.status === "importing" && (
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
                      onClick={() => { setImportId(null); setImportStatus(null); setPickerOpened(false); setPendingState(null); }}
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
