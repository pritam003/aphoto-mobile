import { useState } from "react";
import { RotateCcw, Trash2, BookImage } from "lucide-react";
import { useListPhotos, useTrashPhoto, useDeletePhoto, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import PhotoGrid from "@/components/PhotoGrid";
import { API_BASE } from "@/lib/api";

function useTrashedAlbums() {
  const [albums, setAlbums] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    try {
      const res = await fetch(`${API_BASE}/albums/trashed`, { credentials: "include" });
      if (res.ok) setAlbums(await res.json());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };
  useState(() => { reload(); });
  return { albums, loading, reload };
}

export default function TrashPage() {
  const queryClient = useQueryClient();
  const params = { trashed: true, limit: 500 };
  const { data, isLoading } = useListPhotos(params as any, {
    query: { queryKey: getListPhotosQueryKey(params as any) },
  });

  const photos = data?.photos ?? [];
  const trashPhoto = useTrashPhoto();
  const deletePhoto = useDeletePhoto();
  const { albums: trashedAlbums, loading: albumsLoading, reload: reloadAlbums } = useTrashedAlbums();

  const restoreAll = async () => {
    await Promise.all(photos.map(p => trashPhoto.mutateAsync({ id: p.id, data: { trashed: false } })));
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
  };

  const emptyTrash = async () => {
    if (!confirm("Permanently delete all trashed photos? This cannot be undone.")) return;
    await Promise.all(photos.map(p => deletePhoto.mutateAsync({ id: p.id })));
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
  };

  const restoreAlbum = async (id: string) => {
    await fetch(`${API_BASE}/albums/${id}/restore`, { method: "POST", credentials: "include" });
    reloadAlbums();
  };

  const deleteAlbumPermanently = async (id: string, name: string) => {
    if (!confirm(`Permanently delete album "${name}" and unlink all its photos? This cannot be undone.`)) return;
    await fetch(`${API_BASE}/albums/${id}?permanent=true`, { method: "DELETE", credentials: "include" });
    reloadAlbums();
  };

  const totalItems = photos.length + trashedAlbums.length;

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-foreground">Trash</h1>
        <span className="text-sm text-muted-foreground">{totalItems} item{totalItems !== 1 ? "s" : ""}</span>
        <div className="flex-1" />
        {photos.length > 0 && (
          <div className="flex gap-2">
            <button onClick={restoreAll} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Restore all
            </button>
            <button onClick={emptyTrash} className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Empty trash
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-8">
        {totalItems > 0 && (
          <p className="text-xs text-muted-foreground">Items in trash will be permanently deleted after 30 days</p>
        )}

        {/* Trashed albums */}
        {!albumsLoading && trashedAlbums.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold text-foreground">Albums</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {trashedAlbums.map((album: any) => (
                <div key={album.id} className="bg-muted/40 rounded-xl border border-border p-4 flex flex-col gap-3">
                  <div className="flex items-center gap-2">
                    <BookImage className="w-8 h-8 text-muted-foreground/60 shrink-0" />
                    <p className="text-sm font-medium text-foreground truncate">{album.name}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => restoreAlbum(album.id)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg border border-border hover:bg-muted transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Restore
                    </button>
                    <button
                      onClick={() => deleteAlbumPermanently(album.id, album.name)}
                      className="flex-1 flex items-center justify-center gap-1 py-1.5 text-xs rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
                    >
                      <Trash2 className="w-3 h-3" /> Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Trashed photos */}
        <div>
          {trashedAlbums.length > 0 && photos.length > 0 && (
            <h2 className="text-sm font-semibold text-foreground mb-3">Photos</h2>
          )}
          {isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="aspect-square bg-muted animate-pulse rounded-sm" />
              ))}
            </div>
          ) : (
            <PhotoGrid photos={photos} emptyMessage={trashedAlbums.length > 0 ? "No photos in trash" : "Trash is empty"} />
          )}
        </div>
      </div>
    </div>
  );
}

