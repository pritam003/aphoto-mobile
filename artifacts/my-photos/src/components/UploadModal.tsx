import { useCallback, useState, useRef, useEffect } from "react";
import { X, CloudUpload, CheckCircle, AlertCircle, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPhotosQueryKey, getGetPhotoStatsQueryKey, getListAlbumPhotosQueryKey, getListAlbumsQueryKey } from "@workspace/api-client-react";
import { API_BASE } from "@/lib/api";
import exifr from "exifr";

function parseExifDate(raw: unknown): string | null {
  if (!raw) return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw.toISOString();
  if (typeof raw === "string") {
    const normalized = raw.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3").replace(" ", "T");
    const d = new Date(normalized);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

interface UploadModalProps {
  onClose: () => void;
  albumId?: string;
  albumName?: string;
}

interface UploadFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  previewUrl: string;
  error?: string;
}

function VideoThumb({ file }: { file: File }) {
  const [thumb, setThumb] = useState<string | null>(null);
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata"; video.muted = true; video.playsInline = true; video.src = url;
    video.addEventListener("loadedmetadata", () => { video.currentTime = Math.min(1, video.duration / 2); });
    video.addEventListener("seeked", () => {
      const c = document.createElement("canvas");
      c.width = video.videoWidth || 96; c.height = video.videoHeight || 96;
      c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
      setThumb(c.toDataURL()); URL.revokeObjectURL(url);
    });
    video.addEventListener("error", () => URL.revokeObjectURL(url));
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!thumb) return <div className="w-full h-full bg-muted flex items-center justify-center text-muted-foreground text-xs">▶</div>;
  return <img src={thumb} alt="" className="w-full h-full object-cover" />;
}

export default function UploadModal({ onClose, albumId, albumName }: UploadModalProps) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fileList: File[]) => {
    const valid = fileList.filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    setFiles(prev => [
      ...prev,
      ...valid.map(f => ({
        file: f,
        status: "pending" as const,
        previewUrl: f.type.startsWith("image/") ? URL.createObjectURL(f) : "",
      })),
    ]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const uploadAll = async () => {
    setUploading(true);
    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== "pending") continue;
      setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "uploading" } : f));
      try {
        const f = files[i].file;
        let takenAt: string | null = null;
        if (f.type.startsWith("image/")) {
          const exif = await exifr.parse(f, { pick: ["DateTimeOriginal", "DateTimeDigitized", "CreateDate", "DateTime"] }).catch(() => null);
          const raw = exif?.DateTimeOriginal ?? exif?.DateTimeDigitized ?? exif?.CreateDate ?? exif?.DateTime;
          takenAt = parseExifDate(raw);
        }
        const presignRes = await fetch(`${API_BASE}/photos/presign`, {
          method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
          body: JSON.stringify({ filename: f.name, contentType: f.type, albumId }),
        });
        if (!presignRes.ok) throw new Error(await presignRes.text());
        const { uploadUrl, blobName, cacheControl } = await presignRes.json() as { uploadUrl: string | null; blobName: string; cacheControl?: string };

        if (uploadUrl) {
          const putRes = await fetch(uploadUrl, {
            method: "PUT",
            headers: { "x-ms-blob-type": "BlockBlob", "Content-Type": f.type, ...(cacheControl ? { "x-ms-blob-cache-control": cacheControl } : {}) },
            body: f,
          });
          if (!putRes.ok) throw new Error(`Blob upload failed: ${putRes.status}`);
          const regRes = await fetch(`${API_BASE}/photos/register`, {
            method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include",
            body: JSON.stringify({ blobName, filename: f.name, contentType: f.type, size: f.size, albumId, takenAt }),
          });
          if (!regRes.ok) throw new Error(await regRes.text());
        } else {
          const formData = new FormData();
          formData.append("file", f);
          if (albumId) formData.append("albumId", albumId);
          const res = await fetch(`${API_BASE}/photos`, { method: "POST", body: formData, credentials: "include" });
          if (!res.ok) throw new Error(await res.text());
        }
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "done" } : f));
      } catch (err) {
        setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "error", error: String(err) } : f));
      }
    }
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
    if (albumId) {
      queryClient.invalidateQueries({ queryKey: getListAlbumPhotosQueryKey(albumId) });
      queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
    }
    setUploading(false);
  };

  const pendingCount = files.filter(f => f.status === "pending").length;
  const doneCount   = files.filter(f => f.status === "done").length;
  const errorCount  = files.filter(f => f.status === "error").length;
  const isActive    = uploading || files.some(f => f.status === "uploading");
  const allDone     = files.length > 0 && files.every(f => f.status === "done" || f.status === "error");

  const title = albumName
    ? `Upload to "${albumName}"`
    : files.length === 0 ? "Upload Photos"
    : allDone ? `${doneCount} uploaded${errorCount ? `, ${errorCount} failed` : ""}`
    : isActive ? `Uploading ${doneCount}/${files.length}…`
    : `${files.length} file${files.length !== 1 ? "s" : ""} ready`;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 rounded-2xl bg-card border border-border shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <CloudUpload className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-semibold text-foreground truncate">{title}</span>
          {isActive && <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setCollapsed(c => !c)} className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors">
            {collapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted text-muted-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-4 space-y-3">
          {/* Drop zone — shown when no files yet */}
          {files.length === 0 && (
            <div
              onDrop={handleDrop}
              onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onClick={() => inputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
              }`}
            >
              <CloudUpload className={`w-8 h-8 mx-auto mb-2 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
              <p className="text-xs font-medium text-foreground">Drop photos or click to browse</p>
              <p className="text-xs text-muted-foreground mt-0.5">JPG, PNG, HEIC, MP4</p>
              <input ref={inputRef} type="file" multiple accept="image/*,video/*" className="hidden"
                onChange={e => addFiles(Array.from(e.target.files || []))} />
            </div>
          )}

          {/* Thumbnail grid — shown once files are picked */}
          {files.length > 0 && (
            <>
              {/* Add more + drop zone row */}
              {!isActive && (
                <div
                  onDrop={handleDrop}
                  onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onClick={() => inputRef.current?.click()}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer transition-colors text-xs ${
                    isDragging ? "border-primary bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  <CloudUpload className="w-3.5 h-3.5 shrink-0" />
                  Add more photos
                  <input ref={inputRef} type="file" multiple accept="image/*,video/*" className="hidden"
                    onChange={e => addFiles(Array.from(e.target.files || []))} />
                </div>
              )}

              {/* Photo grid */}
              <div className="grid grid-cols-5 gap-1 max-h-48 overflow-y-auto">
                {files.map((f, i) => (
                  <div key={i} className="relative aspect-square rounded overflow-hidden bg-muted">
                    {f.file.type.startsWith("video/")
                      ? <VideoThumb file={f.file} />
                      : <img src={f.previewUrl} alt="" className="w-full h-full object-cover" />
                    }
                    {/* Status overlay */}
                    {f.status === "uploading" && (
                      <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                        <Loader2 className="w-4 h-4 text-white animate-spin" />
                      </div>
                    )}
                    {f.status === "done" && (
                      <div className="absolute bottom-0.5 right-0.5">
                        <CheckCircle className="w-3.5 h-3.5 text-green-400 drop-shadow" />
                      </div>
                    )}
                    {f.status === "error" && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <AlertCircle className="w-4 h-4 text-destructive" />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Progress bar when uploading */}
              {isActive && files.length > 0 && (
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{ width: `${Math.round((doneCount / files.length) * 100)}%` }}
                  />
                </div>
              )}

              {/* Action row */}
              <div className="flex items-center gap-2">
                {pendingCount > 0 && !isActive && (
                  <button
                    onClick={uploadAll}
                    className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                  >
                    Upload {pendingCount} photo{pendingCount !== 1 ? "s" : ""}
                  </button>
                )}
                {allDone && (
                  <button
                    onClick={onClose}
                    className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
                  >
                    Done
                  </button>
                )}
                {!allDone && (
                  <button
                    onClick={onClose}
                    className="px-3 py-2 rounded-lg border border-border text-xs text-muted-foreground hover:bg-muted transition-colors"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
