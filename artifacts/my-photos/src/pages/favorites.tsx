import { useListPhotos, getListPhotosQueryKey } from "@workspace/api-client-react";
import PhotoGrid from "@/components/PhotoGrid";

export default function FavoritesPage() {
  const params = { favorite: true, trashed: false, limit: 500 };
  const { data, isLoading } = useListPhotos(params as any, {
    query: { queryKey: getListPhotosQueryKey(params as any) },
  });

  const photos = data?.photos ?? [];

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-foreground">Favorites</h1>
        <span className="text-sm text-muted-foreground">{photos.length} photo{photos.length !== 1 ? "s" : ""}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-sm" />
            ))}
          </div>
        ) : (
          <PhotoGrid photos={photos} emptyMessage="No favorites yet — star photos to find them here" />
        )}
      </div>
    </div>
  );
}
