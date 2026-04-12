import { useState, useEffect, useRef } from "react";
import { Heart, FolderPlus, Check, FolderMinus, Trash2, Download, X, EyeOff, Eye } from "lucide-react";
import { groupPhotosByDate } from "@/lib/api";
import Lightbox from "./Lightbox";
import { useListAlbums, useAddPhotoToAlbum, useTrashPhoto, getListAlbumsQueryKey, getListAlbumPhotosQueryKey, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";

interface PhotoGridProps {
  photos: any[];
  emptyMessage?: string;
  onRemoveFromAlbum?: (photoId: string) => void;
  onTrash?: (photoId: string) => void;
  onBulkTrash?: (ids: string[]) => Promise<void>;
  onHide?: (photoId: string) => void;
  onBulkHide?: (ids: string[]) => Promise<void>;
}

export default function PhotoGrid({ photos, emptyMessage = "No photos yet", onRemoveFromAlbum, onTrash, onBulkTrash, onHide, onBulkHide }: PhotoGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const trashPhoto = useTrashPhoto();
  const selecting = selectedIds.size > 0;

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleBulkDownload = async () => {
    const selectedPhotos = photos.filter(p => selectedIds.has(p.id));
    for (const photo of selectedPhotos) {
      try {
        const response = await fetch(photo.url || photo.thumbnailUrl, { credentials: "include" });
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objectUrl;
        a.download = photo.filename || "photo.jpg";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objectUrl);
        await new Promise(r => setTimeout(r, 200));
      } catch { /* skip failed */ }
    }
  };

  const handleBulkTrash = async () => {
    const ids = Array.from(selectedIds);
    if (onBulkTrash) {
      await onBulkTrash(ids);
    } else {
      await Promise.all(ids.map(id => trashPhoto.mutateAsync({ id, data: { trashed: true } })));
      queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
    }
    setSelectedIds(new Set());
  };

  const handleBulkHide = async () => {
    const ids = Array.from(selectedIds);
    if (onBulkHide) {
      await onBulkHide(ids);
    } else {
      await Promise.all(ids.map(id =>
        fetch(`${API_BASE}/photos/${id}/hide`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ hidden: true }),
        })
      ));
      queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
    }
    setSelectedIds(new Set());
  };

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-base">{emptyMessage}</p>
      </div>
    );
  }

  const grouped = groupPhotosByDate(photos);

  return (
    <>
      {Object.entries(grouped).map(([month, monthPhotos]) => {
        const startIndex = photos.findIndex(p => p.id === monthPhotos[0].id);
        return (
          <div key={month} className="mb-8">
            <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-1">{month}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
              {monthPhotos.map((photo: any, i: number) => (
                <PhotoThumbnail
                  key={photo.id}
                  photo={photo}
                  onClick={() => setLightboxIndex(startIndex + i)}
                  onRemoveFromAlbum={onRemoveFromAlbum}
                  onTrash={onTrash}
                  onHide={onHide}
                  selected={selectedIds.has(photo.id)}
                  selecting={selecting}
                  onToggleSelect={handleToggleSelect}
                />
              ))}
            </div>
          </div>
        );
      })}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      {/* Multi-select floating action bar */}
      {selecting && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 bg-card border border-border rounded-2xl shadow-2xl">
          <span className="text-sm font-medium text-foreground">{selectedIds.size} selected</span>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            onClick={() => setSelectedIds(new Set(photos.map(p => p.id)))}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
          >
            Select all
          </button>
          <button
            onClick={handleBulkDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
          <button
            onClick={handleBulkHide}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            <EyeOff className="w-3.5 h-3.5" />
            Hide
          </button>
          <button
            onClick={handleBulkTrash}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-1"
            title="Clear selection"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </>
  );
}

function VideoFrameThumbnail({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [thumb, setThumb] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;
    video.src = src;
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(1, video.duration / 2);
    });
    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumb(canvas.toDataURL("image/jpeg", 0.7));
    });
    video.addEventListener("error", () => setFailed(true));
  }, [src]);

  if (failed || (!thumb)) return null;
  return <img src={thumb} alt={alt} className={className} />;
}

function VideoThumbnailCell({ src, alt }: { src: string; alt: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "metadata";
    video.muted = true;
    video.src = src;
    video.addEventListener("loadedmetadata", () => {
      video.currentTime = Math.min(1, video.duration / 2);
    });
    video.addEventListener("seeked", () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      setThumb(canvas.toDataURL("image/jpeg", 0.7));
    });
  }, [src]);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // prevent lightbox from opening
    if (!videoRef.current) return;
    if (playing) {
      videoRef.current.pause();
      videoRef.current.currentTime = 0;
      setPlaying(false);
    } else {
      videoRef.current.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    }
  };

  return (
    <div className="w-full h-full cursor-pointer" onClick={handleClick}>
      {/* Still frame — hidden while video plays */}
      {thumb && (
        <img
          src={thumb}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${playing ? "opacity-0" : "opacity-100"}`}
        />
      )}
      {/* Video always in DOM (preload="none" avoids downloads), play/pause via ref */}
      <video
        ref={videoRef}
        src={src}
        className={`w-full h-full object-cover transition-opacity duration-150 ${playing ? "opacity-100" : "opacity-0"}`}
        muted
        loop
        playsInline
        preload="none"
        onEnded={() => setPlaying(false)}
        onError={() => setPlaying(false)}
      />
      {/* Play badge — hidden while playing */}
      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-150 ${playing ? "opacity-0" : "opacity-100"}`}>
        <div className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center">
          <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
    </div>
  );
}

function PhotoThumbnail({ photo, onClick, onRemoveFromAlbum, onTrash, onHide, selected, selecting, onToggleSelect }: {
  photo: any;
  onClick: () => void;
  onRemoveFromAlbum?: (photoId: string) => void;
  onTrash?: (photoId: string) => void;
  onHide?: (photoId: string) => void;
  selected: boolean;
  selecting: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const isVideo = photo.contentType?.startsWith("video/") || /\.(mp4|mov|webm|avi|mkv)$/i.test(photo.filename || "");
  const thumbUrl = photo.thumbnailUrl || photo.url;
  const [showAlbumPicker, setShowAlbumPicker] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: albums } = useListAlbums({ query: { queryKey: getListAlbumsQueryKey(), enabled: showAlbumPicker } });
  const addPhoto = useAddPhotoToAlbum();

  const handleAddToAlbum = async (e: React.MouseEvent, albumId: string) => {
    e.stopPropagation();
    await addPhoto.mutateAsync({ id: albumId, data: { photoId: photo.id } });
    queryClient.invalidateQueries({ queryKey: getListAlbumPhotosQueryKey(albumId) });
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
    setAdded(albumId);
    setTimeout(() => { setAdded(null); setShowAlbumPicker(false); }, 800);
  };

  return (
    <button
      onClick={() => selecting ? onToggleSelect(photo.id) : onClick()}
      data-testid={`photo-${photo.id}`}
      className="relative aspect-square bg-muted overflow-hidden rounded-sm group focus:outline-none focus:ring-2 focus:ring-primary"
    >
      {!error ? (
        isVideo ? (
          <VideoThumbnailCell src={thumbUrl} alt={photo.filename} />
        ) : (
        <img
          src={photo.thumbnailUrl || photo.url}
          alt={photo.filename}
          loading="lazy"
          decoding="async"
          className={`w-full h-full object-cover transition-transform duration-300 group-hover:scale-105 ${loaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
        )
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-muted">
          <span className="text-muted-foreground text-xs text-center px-1 break-all">{photo.filename}</span>
        </div>
      )}
      {!loaded && !error && !isVideo && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}

      {/* Selection checkbox — top left */}
      <div
        className={`absolute top-1.5 left-1.5 z-10 transition-opacity ${selected || selecting ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        onClick={e => { e.stopPropagation(); onToggleSelect(photo.id); }}
      >
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors ${selected ? "bg-primary border-primary" : "border-white bg-black/40"}`}>
          {selected && <Check className="w-3 h-3 text-white" />}
        </div>
      </div>

      {photo.favorite && (
        <div className="absolute top-1.5 right-1.5">
          <Heart className="w-3.5 h-3.5 text-white fill-red-400 drop-shadow-sm" />
        </div>
      )}

      {/* Per-photo action buttons — hidden in select mode */}
      {!selecting && (
        <div
          className="absolute bottom-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1"
          onClick={e => e.stopPropagation()}
        >
          <div
            onClick={e => { e.stopPropagation(); setShowAlbumPicker(v => !v); }}
            className="bg-black/60 hover:bg-black/80 rounded-md p-1 cursor-pointer"
            title="Add to album"
          >
            <FolderPlus className="w-3.5 h-3.5 text-white" />
          </div>
          {onRemoveFromAlbum && (
            <div
              onClick={e => { e.stopPropagation(); onRemoveFromAlbum(photo.id); }}
              className="bg-black/60 hover:bg-black/80 rounded-md p-1 cursor-pointer"
              title="Remove from album"
            >
              <FolderMinus className="w-3.5 h-3.5 text-white" />
            </div>
          )}
          {onHide && (
            <div
              onClick={e => { e.stopPropagation(); onHide(photo.id); }}
              className="bg-black/60 hover:bg-black/80 rounded-md p-1 cursor-pointer"
              title={photo.hidden ? "Unhide photo" : "Hide photo"}
            >
              {photo.hidden
                ? <Eye className="w-3.5 h-3.5 text-white" />
                : <EyeOff className="w-3.5 h-3.5 text-white" />
              }
            </div>
          )}
          {onTrash && (
            <div
              onClick={e => { e.stopPropagation(); onTrash(photo.id); }}
              className="bg-black/60 hover:bg-red-600/80 rounded-md p-1 cursor-pointer"
              title="Move to trash"
            >
              <Trash2 className="w-3.5 h-3.5 text-white" />
            </div>
          )}
        </div>
      )}

      <div className={`absolute inset-0 transition-colors ${selected ? "bg-primary/20" : "bg-black/0 group-hover:bg-black/10"}`} />

      {/* Album picker dropdown */}
      {showAlbumPicker && !selecting && (
        <div
          className="absolute bottom-8 left-1 z-20 bg-card border border-border rounded-lg shadow-lg min-w-36 max-h-48 overflow-y-auto"
          onClick={e => e.stopPropagation()}
        >
          {!albums || albums.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2">No albums yet</p>
          ) : (
            albums.map((album: any) => (
              <button
                key={album.id}
                onClick={e => handleAddToAlbum(e, album.id)}
                className="w-full text-left px-3 py-2 text-xs hover:bg-muted flex items-center justify-between gap-2"
              >
                <span className="truncate">{album.name}</span>
                {added === album.id && <Check className="w-3 h-3 text-green-500 shrink-0" />}
              </button>
            ))
          )}
        </div>
      )}
    </button>
  );
}
