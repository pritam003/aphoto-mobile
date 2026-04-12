import { useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { useListPhotos, useTrashPhoto, useDeletePhoto, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import PhotoGrid from "@/components/PhotoGrid";
import Lightbox from "@/components/Lightbox";

export default function TrashPage() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const queryClient = useQueryClient();
  const params = { trashed: true, limit: 50 };
  const { data, isLoading } = useListPhotos(params as any, {
    query: { queryKey: getListPhotosQueryKey(params as any) },
  });

  const photos = data?.photos ?? [];
  const trashPhoto = useTrashPhoto();
  const deletePhoto = useDeletePhoto();

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

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-foreground">Trash</h1>
        <span className="text-sm text-muted-foreground">{photos.length} item{photos.length !== 1 ? "s" : ""}</span>
        <div className="flex-1" />
        {photos.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={restoreAll}
              data-testid="button-restore-all"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Restore all
            </button>
            <button
              onClick={emptyTrash}
              data-testid="button-empty-trash"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Empty trash
            </button>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {photos.length > 0 && (
          <p className="text-xs text-muted-foreground mb-4">Items in trash will be permanently deleted after 30 days</p>
        )}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-sm" />
            ))}
          </div>
        ) : (
          <PhotoGrid photos={photos} emptyMessage="Trash is empty" />
        )}
      </div>
    </div>
  );
}
