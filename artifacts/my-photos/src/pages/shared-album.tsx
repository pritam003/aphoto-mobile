import { useRoute } from "wouter";
import { useState, useEffect, useRef, useCallback } from "react";
import { Images, Upload, X, Check, AlertCircle, Download, ArrowDownToLine } from "lucide-react";
import { API_BASE } from "@/lib/api";

interface Photo {
  id: string;
  url: string;
  thumbnailUrl?: string;
  filename: string;
  contentType?: string;
  takenAt?: string;
  uploadedAt: string;
}

function isVideo(photo: Photo) {
  return (
    photo.contentType?.startsWith("video/") ||
    /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(photo.filename ?? "")
  );
}

interface SharedAlbumData {
  album: { id: string; name: string };
  photos: Photo[];
  permission: "view" | "contribute";
}

type UploadState =
  | { status: "idle" }
  | { status: "uploading"; name: string; progress: number }
  | { status: "done"; name: string }
  | { status: "error"; name: string; message: string };

// ── Download helpers ──────────────────────────────────────────────────────────
async function downloadSingle(photo: Photo) {
  try {
    const res = await fetch(photo.url);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = photo.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    window.open(photo.url, "_blank");
  }
}

export default function SharedAlbumPage() {
  const [, params] = useRoute("/shared/album/:token");
  const token = params?.token ?? "";

  const [data, setData] = useState<SharedAlbumData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Multi-select ────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState(false);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedIds(new Set(data?.photos.map(p => p.id) ?? []));
  const clearSelection = () => setSelectedIds(new Set());

  const downloadZip = async () => {
    if (selectedIds.size === 0 || !data) return;
    setZipping(true);
    try {
      const res = await fetch(`${API_BASE}/shared/albums/${token}/download-zip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoIds: [...selectedIds] }),
      });
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${data.album.name}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setSelectedIds(new Set());
    } catch {
      // noop — browser shows its own error
    } finally {
      setZipping(false);
    }
  };

  // ── Load album ─────────────────────────────────────────────────────────────
  const loadAlbum = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/shared/albums/${token}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      setData(json);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { loadAlbum(); }, [loadAlbum]);

  // ── Keyboard nav ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!lightbox || !data) return;
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowRight") {
        const idx = data.photos.indexOf(lightbox);
        if (idx < data.photos.length - 1) setLightbox(data.photos[idx + 1]);
      }
      if (e.key === "ArrowLeft") {
        const idx = data.photos.indexOf(lightbox);
        if (idx > 0) setLightbox(data.photos[idx - 1]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [lightbox, data]);

  // ── Upload ─────────────────────────────────────────────────────────────────
  const uploadFile = async (file: File) => {
    setUploadState({ status: "uploading", name: file.name, progress: 0 });
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch(`${API_BASE}/shared/albums/${token}/photos`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      setUploadState({ status: "done", name: file.name });
      await loadAlbum();
      setTimeout(() => setUploadState({ status: "idle" }), 3000);
    } catch (err: any) {
      setUploadState({ status: "error", name: file.name, message: err.message ?? "Upload failed" });
      setTimeout(() => setUploadState({ status: "idle" }), 4000);
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    uploadFile(files[0]);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  // ── States ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center px-4">
          <Images className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-foreground mb-1">Album not found</h2>
          <p className="text-sm text-muted-foreground">This share link may have expired or been revoked.</p>
        </div>
      </div>
    );
  }

  const { album, photos, permission } = data;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center gap-3 sticky top-0 bg-background/80 backdrop-blur z-10">
        <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Images className="w-4 h-4 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate block">{album.name}</span>
          <span className="text-xs text-muted-foreground">
            {selectedIds.size > 0
              ? `${selectedIds.size} of ${photos.length} selected`
              : `${photos.length} item${photos.length !== 1 ? "s" : ""}`}
          </span>
        </div>

        {/* Selection toolbar */}
        {selectedIds.size > 0 ? (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={selectAll}
              className="text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Select all
            </button>
            <button
              onClick={downloadZip}
              disabled={zipping}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {zipping ? (
                <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin inline-block" />
              ) : (
                <Download className="w-3.5 h-3.5" />
              )}
              {zipping ? "Zipping…" : "Download ZIP"}
            </button>
            <button
              onClick={clearSelection}
              className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 shrink-0">
            {permission === "contribute" && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-primary/10 text-primary font-medium">
                Can contribute
              </span>
            )}
            <span className="text-xs text-muted-foreground">APhoto</span>
          </div>
        )}
      </div>

      <div className="flex-1 px-4 py-6 max-w-6xl mx-auto w-full">
        {/* Contribute drop zone */}
        {permission === "contribute" && (
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => uploadState.status === "idle" && fileInputRef.current?.click()}
            className={`mb-6 flex flex-col items-center justify-center gap-2 py-6 px-6 rounded-2xl border-2 border-dashed transition-colors cursor-pointer select-none ${
              dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={e => handleFiles(e.target.files)} />
            {uploadState.status === "idle" && (<>
              <Upload className="w-6 h-6 text-muted-foreground" />
              <p className="text-sm font-medium text-foreground">Add a photo to this album</p>
              <p className="text-xs text-muted-foreground">Click to browse or drag & drop</p>
            </>)}
            {uploadState.status === "uploading" && (<>
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-foreground">Uploading {uploadState.name}…</p>
            </>)}
            {uploadState.status === "done" && (<>
              <Check className="w-6 h-6 text-green-500" />
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">{uploadState.name} added!</p>
            </>)}
            {uploadState.status === "error" && (<>
              <AlertCircle className="w-6 h-6 text-destructive" />
              <p className="text-sm text-destructive font-medium">{uploadState.message}</p>
            </>)}
          </div>
        )}

        {/* Photo grid */}
        {photos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <Images className="w-12 h-12 text-muted-foreground/30 mb-3" />
            <p className="text-muted-foreground text-sm">No photos yet.</p>
            {permission === "contribute" && <p className="text-xs text-muted-foreground mt-1">Be the first to add one!</p>}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {photos.map(photo => {
              const selected = selectedIds.has(photo.id);
              const video = isVideo(photo);
              return (
                <div
                  key={photo.id}
                  className={`relative aspect-square rounded-sm overflow-hidden bg-muted group cursor-pointer ${selected ? "ring-2 ring-primary ring-offset-1" : ""}`}
                  onClick={() => {
                    if (selectedIds.size > 0) {
                      setSelectedIds(prev => {
                        const next = new Set(prev);
                        next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id);
                        return next;
                      });
                    } else {
                      setLightbox(photo);
                    }
                  }}
                >
                  {video ? (
                    <video
                      src={photo.url}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img
                      src={photo.thumbnailUrl ?? photo.url}
                      alt={photo.filename}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                    />
                  )}

                  {/* Play badge for videos */}
                  {video && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-9 h-9 rounded-full bg-black/55 flex items-center justify-center">
                        <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                      </div>
                    </div>
                  )}

                  {/* Checkbox — visible on hover or when selected */}
                  <div
                    className={`absolute top-1.5 left-1.5 transition-opacity duration-150 ${selected || selectedIds.size > 0 ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                    onClick={e => toggleSelect(photo.id, e)}
                  >
                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? "bg-primary border-primary" : "bg-black/40 border-white/80"}`}>
                      {selected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
          onClick={e => { if (e.currentTarget === e.target) setLightbox(null); }}
        >
          {/* Close */}
          <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors z-10">
            <X className="w-5 h-5" />
          </button>

          {/* Download single */}
          <button
            onClick={() => downloadSingle(lightbox)}
            className="absolute top-4 right-14 p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors z-10"
            title="Download"
          >
            <ArrowDownToLine className="w-5 h-5" />
          </button>

          {/* Prev */}
          {data.photos.indexOf(lightbox) > 0 && (
            <button
              onClick={() => setLightbox(data.photos[data.photos.indexOf(lightbox) - 1])}
              className="absolute left-4 p-3 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors text-lg z-10"
            >
              ‹
            </button>
          )}

          {/* Next */}
          {data.photos.indexOf(lightbox) < data.photos.length - 1 && (
            <button
              onClick={() => setLightbox(data.photos[data.photos.indexOf(lightbox) + 1])}
              className="absolute right-4 p-3 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors text-lg z-10"
            >
              ›
            </button>
          )}

          {/* Media */}
          {isVideo(lightbox) ? (
            <video
              key={lightbox.id}
              src={lightbox.url}
              className="max-h-[90vh] max-w-[90vw] rounded-lg shadow-2xl"
              controls
              autoPlay
              playsInline
            />
          ) : (
            <img
              key={lightbox.id}
              src={lightbox.url}
              alt={lightbox.filename}
              className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg shadow-2xl"
            />
          )}

          <div className="absolute bottom-4 left-0 right-0 text-center pointer-events-none">
            <p className="text-white/70 text-sm">{lightbox.filename}</p>
          </div>
        </div>
      )}
    </div>
  );
}


