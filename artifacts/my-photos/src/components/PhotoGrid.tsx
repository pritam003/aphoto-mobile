import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { Heart, FolderPlus, Check, FolderMinus, Trash2, Download, X, EyeOff, Eye } from "lucide-react";
import { groupPhotosByDate } from "@/lib/api";
import Lightbox from "./Lightbox";
import { useListAlbums, useAddPhotoToAlbum, useTrashPhoto, getListAlbumsQueryKey, getListAlbumPhotosQueryKey, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE } from "@/lib/api";

interface PhotoGridProps {
  photos: any[];
  emptyMessage?: string;
  dateField?: "taken" | "uploaded";
  onRemoveFromAlbum?: (photoId: string) => void;
  onTrash?: (photoId: string) => void;
  onBulkTrash?: (ids: string[]) => Promise<void>;
  onHide?: (photoId: string) => void;
  onBulkHide?: (ids: string[]) => Promise<void>;
}

export default function PhotoGrid({ photos, emptyMessage = "No photos yet", dateField = "taken", onRemoveFromAlbum, onTrash, onBulkTrash, onHide, onBulkHide }: PhotoGridProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const trashPhoto = useTrashPhoto();
  const selecting = selectedIds.size > 0;

  // O(1) index lookup — avoids scanning allPhotos on every thumbnail render
  const photoIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    photos.forEach((p, i) => m.set(p.id, i));
    return m;
  }, [photos]);

  const grouped = useMemo(() => groupPhotosByDate(photos, dateField), [photos, dateField]);

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleOpenLightbox = useCallback((idx: number) => setLightboxIndex(idx), []);

  const handleBulkDownload = useCallback(async () => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos, selectedIds]);

  const handleBulkTrash = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (onBulkTrash) {
      await onBulkTrash(ids);
    } else {
      await Promise.all(ids.map(id => trashPhoto.mutateAsync({ id, data: { trashed: true } })));
      queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
    }
    setSelectedIds(new Set());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBulkTrash, selectedIds]);

  const handleBulkHide = useCallback(async () => {
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBulkHide, selectedIds]);

  if (photos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
        <p className="text-base">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      {Object.entries(grouped).map(([month, monthPhotos]) => (
        <MonthGroup
          key={month}
          month={month}
          monthPhotos={monthPhotos}
          photoIndexMap={photoIndexMap}
          onOpenLightbox={handleOpenLightbox}
          onRemoveFromAlbum={onRemoveFromAlbum}
          onTrash={onTrash}
          onHide={onHide}
          selectedIds={selectedIds}
          selecting={selecting}
          onToggleSelect={handleToggleSelect}
        />
      ))}

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

const STACK_THRESHOLD = 10;

function StackCell({ hiddenCount, previews, onExpand }: { hiddenCount: number; previews: any[]; onExpand: () => void }) {
  return (
    <button
      onClick={onExpand}
      className="relative aspect-square overflow-hidden rounded-lg focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:z-10"
      title={`Show ${hiddenCount} more photos`}
    >
      {/* Stacked card layers behind (bottom to top) */}
      {previews.slice(0, 3).reverse().map((photo, i) => (
        <div
          key={photo.id}
          className="absolute inset-0 rounded-sm overflow-hidden border border-background"
          style={{
            transform: `translate(${(2 - i) * 4}px, ${(2 - i) * -4}px) rotate(${(2 - i) * 2}deg)`,
            zIndex: i,
          }}
        >
          <img
            src={photo.thumbnailUrl || photo.url}
            alt=""
            className="w-full h-full object-cover"
            loading="lazy"
          />
          <div className="absolute inset-0 bg-black/20" />
        </div>
      ))}
      {/* Top card with count badge */}
      <div className="absolute inset-0 rounded-sm overflow-hidden border border-background bg-muted" style={{ zIndex: 3 }}>
        <img
          src={previews[0]?.thumbnailUrl || previews[0]?.url}
          alt=""
          className="w-full h-full object-cover opacity-60"
          loading="lazy"
        />
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40">
          <span className="text-white font-bold text-xl leading-tight">+{hiddenCount}</span>
          <span className="text-white/80 text-xs mt-0.5">more</span>
        </div>
      </div>
    </button>
  );
}

const MonthGroup = memo(function MonthGroup({ month, monthPhotos, photoIndexMap, onOpenLightbox, onRemoveFromAlbum, onTrash, onHide, selectedIds, selecting, onToggleSelect }: {
  month: string;
  monthPhotos: any[];
  photoIndexMap: Map<string, number>;
  onOpenLightbox: (idx: number) => void;
  onRemoveFromAlbum?: (photoId: string) => void;
  onTrash?: (photoId: string) => void;
  onHide?: (photoId: string) => void;
  selectedIds: Set<string>;
  selecting: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasStack = monthPhotos.length > STACK_THRESHOLD;
  const visiblePhotos = hasStack && !expanded ? monthPhotos.slice(0, STACK_THRESHOLD - 1) : monthPhotos;
  const hiddenCount = monthPhotos.length - (STACK_THRESHOLD - 1);
  const stackPreviews = monthPhotos.slice(STACK_THRESHOLD - 1, STACK_THRESHOLD + 2);

  return (
    <div className="mb-10" style={{ contentVisibility: "auto", containIntrinsicSize: "auto 600px" }}>
      <div className="flex items-center justify-between mb-4 px-1">
        <div className="flex items-center gap-2.5">
          <span className="w-1 h-5 rounded-full bg-primary inline-block" />
          <h2 className="text-base font-bold text-foreground tracking-tight">{month}</h2>
          <span className="text-xs text-muted-foreground font-normal">({monthPhotos.length})</span>
        </div>
        {hasStack && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="text-xs text-primary hover:text-primary/80 font-medium transition-colors px-2.5 py-1 rounded-full bg-primary/8 hover:bg-primary/14"
          >
            {expanded ? "Show less" : `Show all ${monthPhotos.length}`}
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1.5">
        {visiblePhotos.map((photo: any) => {
          const globalIdx = photoIndexMap.get(photo.id) ?? -1;
          return (
            <PhotoThumbnail
              key={photo.id}
              photo={photo}
              globalIndex={globalIdx}
              onOpenLightbox={onOpenLightbox}
              onRemoveFromAlbum={onRemoveFromAlbum}
              onTrash={onTrash}
              onHide={onHide}
              selected={selectedIds.has(photo.id)}
              selecting={selecting}
              onToggleSelect={onToggleSelect}
            />
          );
        })}
        {hasStack && !expanded && (
          <StackCell
            hiddenCount={hiddenCount}
            previews={stackPreviews}
            onExpand={() => setExpanded(true)}
          />
        )}
      </div>
    </div>
  );
});

function VideoThumbnailCell({ src, isHovered }: { src: string; alt: string; isHovered: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const firstFrameTime = useRef(0);

  // Lazy-mount: only render the <video> element when near the viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setInView(true); obs.disconnect(); }
    }, { rootMargin: "300px" });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Native DOM listeners — avoid React synthetic event race condition
  useEffect(() => {
    if (!inView) return;
    const v = videoRef.current;
    if (!v) return;

    const markReady = () => setFrameReady(true);
    const seekToFrame = () => {
      const t = v.duration > 0 ? Math.min(1, v.duration * 0.05) : 0;
      firstFrameTime.current = t;
      v.currentTime = t;
    };
    const onMetadata = () => {
      seekToFrame();
      // Mark ready immediately on metadata — the video element will show
      // whatever frame it has. seeked will fire later with a better frame.
      markReady();
    };

    v.addEventListener("canplay", markReady);
    v.addEventListener("seeked", markReady);
    v.addEventListener("loadedmetadata", onMetadata);

    // Handle already-loaded state
    if (v.readyState >= 3) { markReady(); }
    else if (v.readyState >= 1) { onMetadata(); }

    // Hard fallback: always clear placeholder after 2s regardless of events
    const fallback = setTimeout(markReady, 2000);

    return () => {
      v.removeEventListener("canplay", markReady);
      v.removeEventListener("seeked", markReady);
      v.removeEventListener("loadedmetadata", onMetadata);
      clearTimeout(fallback);
    };
  }, [inView]);

  // Play on hover, reset to first frame on leave.
  // Do NOT guard on frameReady — play() works fine on unloaded video
  // (browser loads + buffers + starts playing once enough data arrives).
  // Including frameReady in deps means we re-run when the still frame is
  // ready, so if the user is still hovering we start playback even if load
  // was slow.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isHovered) {
      v.play().catch(() => {});
    } else {
      v.pause();
      // Only seek back if video has loaded data (avoids invalid state errors)
      if (v.readyState >= 1) v.currentTime = firstFrameTime.current;
    }
  }, [isHovered, frameReady]);

  return (
    <div ref={containerRef} className="w-full h-full relative pointer-events-none">
      {inView && (
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full object-cover"
          muted
          loop
          playsInline
          preload={isHovered ? "auto" : "metadata"}
        />
      )}
      {/* Pulse placeholder until first frame is ready */}
      {(!frameReady || !inView) && (
        <div className="absolute inset-0 bg-muted animate-pulse" />
      )}
      {/* Play badge — fades out while hovering */}
      <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-200 ${isHovered ? "opacity-0" : "opacity-100"}`}>
        <div className="w-9 h-9 rounded-full bg-black/55 shadow-md flex items-center justify-center">
          <svg className="w-4 h-4 text-white ml-0.5" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </div>
      </div>
    </div>
  );
}

const PhotoThumbnail = memo(function PhotoThumbnail({ photo, globalIndex, onOpenLightbox, onRemoveFromAlbum, onTrash, onHide, selected, selecting, onToggleSelect }: {
  photo: any;
  globalIndex: number;
  onOpenLightbox: (idx: number) => void;
  onRemoveFromAlbum?: (photoId: string) => void;
  onTrash?: (photoId: string) => void;
  onHide?: (photoId: string) => void;
  selected: boolean;
  selecting: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [videoHovered, setVideoHovered] = useState(false);
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
      onClick={() => selecting ? onToggleSelect(photo.id) : onOpenLightbox(globalIndex)}
      data-testid={`photo-${photo.id}`}
      className="relative aspect-square bg-muted overflow-hidden rounded-lg group focus:outline-none focus:ring-2 focus:ring-primary transition-all duration-200 hover:scale-[1.03] hover:shadow-lg hover:z-10"
      style={{ contain: "layout style paint" }}
      onMouseEnter={() => isVideo && setVideoHovered(true)}
      onMouseLeave={() => isVideo && setVideoHovered(false)}
    >
      {!error ? (
        isVideo ? (
          <VideoThumbnailCell
            src={thumbUrl}
            alt={photo.filename}
            isHovered={videoHovered}
          />
        ) : (
        <img
          src={photo.thumbnailUrl || photo.url}
          alt={photo.filename}
          loading="lazy"
          decoding="async"
          className={`w-full h-full object-cover ${loaded ? "opacity-100" : "opacity-0"}`}
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
});
