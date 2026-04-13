import { useState, useEffect, useRef } from "react";
import { X, CheckCircle, AlertCircle, Loader2, FolderDown, ExternalLink, FolderInput, ChevronDown, ChevronUp } from "lucide-react";
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

interface ThumbPhoto {
  id: string;
  thumbnailUrl: string;
}

export default function GoogleImportModal({ onClose, activeImportId }: GoogleImportModalProps) {
  const [, navigate] = useLocation();
  const [albumName, setAlbumName] = useState("");
  const [connectError, setConnectError] = useState("");
  const [importId, setImportId] = useState<string | null>(activeImportId ?? null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const [pendingState, setPendingState] = useState<string | null>(null);
  const [thumbs, setThumbs] = useState<ThumbPhoto[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const thumbPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Phase A: poll for importId by state
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

  // Phase B: poll import status
  useEffect(() => {
    if (!importId) return;
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }

    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/google/import/${importId}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as ImportStatus;
        setImportStatus(data);
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

  // Phase C: poll album photos for live thumbnail preview
  useEffect(() => {
    const albumId = importStatus?.albumId;
    if (!albumId) return;
    if (importStatus?.status === "error") return;

    const fetchThumbs = async () => {
      try {
        const res = await fetch(`${API_BASE}/albums/${albumId}/photos`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as { photos: ThumbPhoto[] };
        if (data.photos?.length) setThumbs(data.photos.slice(0, 20));
      } catch {/* ignore */}
    };

    fetchThumbs();
    if (importStatus?.status !== "done") {
      thumbPollRef.current = setInterval(fetchThumbs, 3000);
    }
    return () => { if (thumbPollRef.current) clearInterval(thumbPollRef.current); };
  }, [importStatus?.albumId, importStatus?.status]);

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
      window.open(data.authUrl, "_blank", "noopener,noreferrer");
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

  const isActive = importStatus && (importStatus.status === "importing" || importStatus.status === "picking");

  return (
    /* Bottom-right floating panel — no backdrop so app is visible behind */
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <FolderDown className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">
            {importStatus?.albumName ?? "Import from Google Photos"}
          </span>
          {isActive && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCollapsed(c => !c)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-4">
          {/* Step 1 — enter folder name */}
          {!importId && !pendingState && (
            <>
              <p className="text-xs text-muted-foreground">
                Give the album a name, then sign in with Google to select photos.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-foreground flex items-center gap-1">
                  <FolderInput className="w-3 h-3" /> Folder name
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
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {starting
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Opening…</>
                  : "Connect Google Photos"}
              </button>
            </>
          )}

          {/* Step 2 — waiting for OAuth sign-in */}
          {pendingState && !importId && (
            <div className="flex flex-col items-center gap-3 py-2">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">Waiting for Google sign-in…</p>
                <p className="text-xs text-muted-foreground mt-0.5">Complete sign-in in the new tab.</p>
              </div>
              <button
                onClick={() => { setPendingState(null); setConnectError(""); }}
                className="text-xs text-muted-foreground hover:text-foreground underline"
              >Cancel</button>
            </div>
          )}

          {/* Step 3 — progress */}
          {importId && (
            <div className="space-y-3">
              {/* Status row */}
              {importStatus && (
                <div className="flex items-center gap-2">
                  {importStatus.status === "importing" && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                  {importStatus.status === "done"      && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
                  {importStatus.status === "error"     && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                  {importStatus.status === "picking"   && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                  <div className="flex-1 min-w-0">
                    {importStatus.status === "picking" && (
                      <p className="text-xs text-muted-foreground">Select photos in the Google Photos tab, then click Done.</p>
                    )}
                    {importStatus.status === "importing" && (
                      <p className="text-xs text-muted-foreground">
                        {importStatus.imported} / {importStatus.total} imported
                      </p>
                    )}
                    {importStatus.status === "done" && (
                      <p className="text-xs text-muted-foreground">
                        {importStatus.imported} photo{importStatus.imported !== 1 ? "s" : ""} imported
                        {importStatus.errors > 0 ? `, ${importStatus.errors} skipped` : ""}
                      </p>
                    )}
                    {importStatus.status === "error" && (
                      <p className="text-xs text-destructive truncate">{importStatus.message}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Picker reopen button */}
              {importStatus?.status === "picking" && importStatus.pickerUri && (
                <button
                  onClick={() => window.open(importStatus.pickerUri!, "_blank", "noopener,noreferrer")}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Reopen Picker
                </button>
              )}

              {/* Progress bar */}
              {importStatus && importStatus.status !== "picking" && importStatus.total > 0 && (
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      importStatus.status === "error" ? "bg-destructive" :
                      importStatus.status === "done"  ? "bg-green-500" : "bg-primary"
                    }`}
                    style={{ width: `${importStatus.status === "done" ? 100 : pct}%` }}
                  />
                </div>
              )}

              {/* Live photo thumbnails */}
              {thumbs.length > 0 && (
                <div className="grid grid-cols-5 gap-1">
                  {thumbs.map(t => (
                    <div key={t.id} className="aspect-square rounded overflow-hidden bg-muted">
                      <img
                        src={t.thumbnailUrl}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              {importStatus?.status === "done" && importStatus.albumId && (
                <button
                  onClick={() => { onClose(); navigate(`/albums/${importStatus.albumId}`); }}
                  className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                >
                  View album
                </button>
              )}
              {importStatus?.status === "error" && (
                <button
                  onClick={() => { setImportId(null); setImportStatus(null); setPendingState(null); setThumbs([]); }}
                  className="w-full py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                  Try again
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
