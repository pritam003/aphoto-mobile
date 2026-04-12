import { useListPhotos, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import PhotoGrid from "@/components/PhotoGrid";
import { API_BASE } from "@/lib/api";

export default function ArchivePage() {
  const queryClient = useQueryClient();
  const params = { hidden: true };
  const { data, isLoading } = useListPhotos(params as any, {
    query: { queryKey: getListPhotosQueryKey(params as any) },
  });

  const photos = data?.photos ?? [];

  const unhidePhoto = async (id: string) => {
    await fetch(`${API_BASE}/photos/${id}/hide`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ hidden: false }),
    });
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
  };

  const unhideAll = async () => {
    await Promise.all(photos.map(p => unhidePhoto(p.id)));
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-foreground">Archive</h1>
        <span className="text-sm text-muted-foreground">{photos.length} item{photos.length !== 1 ? "s" : ""}</span>
        <div className="flex-1" />
        {photos.length > 0 && (
          <button
            onClick={unhideAll}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
          >
            Unhide all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-sm" />
            ))}
          </div>
        ) : (
          <PhotoGrid
            photos={photos}
            emptyMessage="No hidden photos"
            onHide={unhidePhoto}
          />
        )}
      </div>
    </div>
  );
}
