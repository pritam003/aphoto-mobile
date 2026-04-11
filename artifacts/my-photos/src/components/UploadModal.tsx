import { useCallback, useState, useRef } from "react";
import { X, CloudUpload, CheckCircle, AlertCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListPhotosQueryKey, getGetPhotoStatsQueryKey, getListAlbumPhotosQueryKey, getListAlbumsQueryKey } from "@workspace/api-client-react";

interface UploadModalProps {
  onClose: () => void;
  albumId?: string;
  albumName?: string;
}

interface UploadFile {
  file: File;
  status: "pending" | "uploading" | "done" | "error";
  error?: string;
}

export default function UploadModal({ onClose, albumId, albumName }: UploadModalProps) {
  const queryClient = useQueryClient();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (fileList: File[]) => {
    const imageFiles = fileList.filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    setFiles(prev => [...prev, ...imageFiles.map(f => ({ file: f, status: "pending" as const }))]);
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const uploadAll = async () => {
    for (let i = 0; i < files.length; i++) {
      if (files[i].status !== "pending") continue;
      setFiles(prev => prev.map((f, idx) => idx === i ? { ...f, status: "uploading" } : f));
      try {
        const formData = new FormData();
        formData.append("file", files[i].file);
        if (albumId) formData.append("albumId", albumId);
        const res = await fetch("/api/photos", { method: "POST", body: formData, credentials: "include" });
        if (!res.ok) throw new Error(await res.text());
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
  };

  const pendingCount = files.filter(f => f.status === "pending").length;
  const doneCount = files.filter(f => f.status === "done").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-foreground">
            {albumName ? `Upload to "${albumName}"` : "Upload Photos"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => inputRef.current?.click()}
            data-testid="upload-dropzone"
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
            }`}
          >
            <CloudUpload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
            <p className="text-sm font-medium text-foreground">Drop photos here</p>
            <p className="text-xs text-muted-foreground mt-1">or click to browse — JPG, PNG, HEIC, MP4</p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="image/*,video/*"
              className="hidden"
              onChange={e => addFiles(Array.from(e.target.files || []))}
            />
          </div>

          {files.length > 0 && (
            <div className="max-h-48 overflow-y-auto space-y-2">
              {files.map((f, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate">{f.file.name}</p>
                    <p className="text-xs text-muted-foreground">{(f.file.size / 1024 / 1024).toFixed(1)} MB</p>
                  </div>
                  {f.status === "uploading" && (
                    <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  )}
                  {f.status === "done" && <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />}
                  {f.status === "error" && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border">
          <span className="text-sm text-muted-foreground">
            {doneCount > 0 ? `${doneCount} of ${files.length} uploaded` : `${files.length} file${files.length !== 1 ? "s" : ""} selected`}
          </span>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
              {doneCount > 0 ? "Done" : "Cancel"}
            </button>
            {pendingCount > 0 && (
              <button
                onClick={uploadAll}
                data-testid="button-start-upload"
                className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Upload {pendingCount} photo{pendingCount !== 1 ? "s" : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
