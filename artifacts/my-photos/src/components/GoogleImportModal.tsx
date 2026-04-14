import { useState, useEffect, useRef } from "react";
import { X, CheckCircle, AlertCircle, Loader2, FolderDown, ExternalLink, FolderInput, ChevronDown, ChevronUp } from "lucide-react";
import { useLocation } from "wouter";
import { API_BASE } from "@/lib/api";

interface GoogleImportModalProps {
  onClose: () => void;
  activeImportId?: string | null;
  /** Album-detail: auto-import into this album ID (no folder creation shown) */
  targetAlbumId?: string;
  /** Album-detail: album name shown in the progress panel */
  albumDisplayName?: string;
  /** Albums list page: show folder name input so user can create a new album */
  allowCreateAlbum?: boolean;
  /** Called once when import finishes successfully */
  onDone?: (albumId?: string) => void;
}

interface ImportStatus {
  status: "picking" | "importing" | "done" | "error";
  albumName: string; albumId?: string;
  total: number; imported: number; errors: number;
  message?: string; pickerUri?: string;
}

interface ThumbPhoto { id: string; thumbnailUrl: string; }

export default function GoogleImportModal({ onClose, activeImportId, targetAlbumId, albumDisplayName, allowCreateAlbum, onDone }: GoogleImportModalProps) {
  const [, navigate] = useLocation();
  const [albumName, setAlbumName] = useState("");
  const [connectError, setConnectError] = useState("");
  const [importId, setImportId]     = useState<string | null>(activeImportId ?? null);
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null);
  const [starting, setStarting]     = useState(false);
  const [pendingState, setPendingState] = useState<string | null>(null);
  const [thumbs, setThumbs]         = useState<ThumbPhoto[]>([]);
  const [collapsed, setCollapsed]   = useState(false);
  const pollRef     = useRef<ReturnType<typeof setInterval> | null>(null);
  const thumbPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const doneFiredRef = useRef(false);

  // Fire onDone once when status transitions to "done", then auto-close after 2s
  useEffect(() => {
    if (importStatus?.status === "done" && !doneFiredRef.current) {
      doneFiredRef.current = true;
      onDone?.(importStatus.albumId);
      setTimeout(() => onClose(), 2000);
    }
  }, [importStatus?.status, importStatus?.albumId, onDone, onClose]);

  // Phase A: poll for importId by state (OAuth tab open)
  useEffect(() => {
    if (!pendingState || importId) return;
    const poll = async () => {
      try {
        const res = await fetch(`${API_BASE}/google/import-by-state/${pendingState}`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as { importId?: string };
        if (data.importId) { setImportId(data.importId); clearInterval(pollRef.current!); pollRef.current = null; }
      } catch { /* keep polling */ }
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
        if (data.status === "done" || data.status === "error") { clearInterval(pollRef.current!); pollRef.current = null; }
      } catch { /* keep polling */ }
    };
    poll();
    pollRef.current = setInterval(poll, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [importId]);

  // Phase C: poll album photos for live thumbnails — newest first, capped to import batch size
  useEffect(() => {
    const albumId = importStatus?.albumId;
    const total = importStatus?.total ?? 40;
    if (!albumId || importStatus?.status === "error") return;
    const fetch_ = async () => {
      try {
        const res = await fetch(`${API_BASE}/albums/${albumId}/photos?orderBy=uploaded`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json() as { photos: ThumbPhoto[] };
        if (data.photos?.length) setThumbs(data.photos.slice(0, total));
      } catch { /* ignore */ }
    };
    fetch_();
    if (importStatus?.status !== "done") {
      thumbPollRef.current = setInterval(fetch_, 3000);
    }
    return () => { if (thumbPollRef.current) clearInterval(thumbPollRef.current); };
  }, [importStatus?.albumId, importStatus?.status, importStatus?.total]);

  const handleConnect = async () => {
    setConnectError(""); setStarting(true);
    try {
      const res = await fetch(`${API_BASE}/google/auth-url`, {
        method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
        body: JSON.stringify({
          albumName: targetAlbumId
            ? (albumDisplayName || "Google Photos Import")
            : (albumName.trim() || "Google Photos Import"),
          targetAlbumId,
          noAlbum: !allowCreateAlbum && !targetAlbumId,
        }),
      });
      const data = await res.json() as { authUrl?: string; state?: string; error?: string };
      if (!res.ok || !data.authUrl) { setConnectError(data.error ?? "Failed to connect. Please try again."); return; }
      window.open(data.authUrl, "_blank", "noopener,noreferrer");
      setPendingState(data.state!);   // → triggers switch to bottom panel
    } catch { setConnectError("Network error — please try again."); }
    finally { setStarting(false); }
  };

  const pct = importStatus && importStatus.total > 0
    ? Math.round(((importStatus.imported + importStatus.errors) / importStatus.total) * 100)
    : 0;

  // Show center modal only during initial setup (before Connect is clicked)
  const isSetup = !pendingState && !importId;

  /* ─── SETUP: center modal ──────────────────────────────────────────── */
  if (isSetup) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
        <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-md">
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-2.5">
              <FolderDown className="w-5 h-5 text-primary" />
              <h2 className="text-base font-semibold text-foreground">Import from Google Photos</h2>
            </div>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-6 space-y-5">
            <p className="text-sm text-muted-foreground">
              {targetAlbumId
                ? "Select photos from Google to add to this album."
                : allowCreateAlbum
                ? "Give the album a name, then sign in with Google to select which photos to import."
                : "Select photos from Google Photos to import to your library."}
            </p>
            {allowCreateAlbum && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
                  <FolderInput className="w-3.5 h-3.5" /> Folder name
                </label>
                <input
                  type="text" value={albumName} onChange={e => setAlbumName(e.target.value)}
                  placeholder="e.g. Summer 2021"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  onKeyDown={e => { if (e.key === "Enter" && !starting) handleConnect(); }}
                />
              </div>
            )}
            {connectError && <p className="text-xs text-destructive">{connectError}</p>}
            <button
              onClick={handleConnect} disabled={starting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {starting ? <><Loader2 className="w-4 h-4 animate-spin" /> Opening Google sign-in…</> : "Connect Google Photos"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─── ACTIVE: bottom-right panel ──────────────────────────────────── */
  const panelTitle = importStatus?.albumName
    ?? (pendingState && !importId ? "Waiting for sign-in…" : "Connecting…");

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <FolderDown className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">{panelTitle}</span>
          {(pendingState || importStatus?.status === "importing" || importStatus?.status === "picking") &&
            <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setCollapsed(c => !c)} className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors">
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {(importStatus?.status === "done" || importStatus?.status === "error") && (
            <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-3">
          {/* Waiting for OAuth */}
          {pendingState && !importId && (
            <div className="flex items-center gap-2 py-1">
              <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Waiting for Google sign-in…</p>
                <p className="text-xs text-muted-foreground">Complete sign-in in the new tab.</p>
              </div>
            </div>
          )}

          {/* Waiting for picker */}
          {importStatus?.status === "picking" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />
                <div>
                  <p className="text-xs font-medium text-foreground">Select photos in Google Photos</p>
                  <p className="text-xs text-muted-foreground">Click Done when finished — import starts automatically.</p>
                </div>
              </div>
              {importStatus.pickerUri && (
                <button
                  onClick={() => window.open(importStatus.pickerUri!, "_blank", "noopener,noreferrer")}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                  <ExternalLink className="w-3.5 h-3.5" /> Reopen Picker
                </button>
              )}
            </div>
          )}

          {/* Importing */}
          {importStatus && importStatus.status !== "picking" && (
            <>
              {/* Status line */}
              <div className="flex items-center gap-2">
                {importStatus.status === "importing" && <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" />}
                {importStatus.status === "done"      && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
                {importStatus.status === "error"     && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                <p className="text-xs text-muted-foreground">
                  {importStatus.status === "importing" && `${importStatus.imported} / ${importStatus.total} imported`}
                  {importStatus.status === "done"      && `${importStatus.imported} photo${importStatus.imported !== 1 ? "s" : ""} imported${importStatus.errors ? `, ${importStatus.errors} skipped` : ""}`}
                  {importStatus.status === "error"     && importStatus.message}
                </p>
              </div>

              {/* Progress bar */}
              {importStatus.total > 0 && (
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

              {/* Live thumbnails — pop in as each photo lands */}
              {thumbs.length > 0 && (
                <div className="grid grid-cols-5 gap-1">
                  {thumbs.map(t => (
                    <div key={t.id} className="aspect-square rounded overflow-hidden bg-muted">
                      <img src={t.thumbnailUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                    </div>
                  ))}
                </div>
              )}

              {/* Actions */}
              {importStatus.status === "done" && importStatus.albumId && (
                <button
                  onClick={() => { onClose(); navigate(`/albums/${importStatus.albumId}`); }}
                  className="w-full py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                >
                  View album
                </button>
              )}
              {importStatus.status === "error" && (
                <button
                  onClick={() => { setImportId(null); setImportStatus(null); setPendingState(null); setThumbs([]); }}
                  className="w-full py-2 rounded-lg border border-border text-xs font-medium hover:bg-muted transition-colors"
                >
                  Try again
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
