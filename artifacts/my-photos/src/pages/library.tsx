import { useState, useCallback, useRef } from "react";
import { Search, X } from "lucide-react";
import { useListPhotos, getListPhotosQueryKey } from "@workspace/api-client-react";
import PhotoGrid from "@/components/PhotoGrid";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { API_BASE } from "@/lib/api";

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [isDroppingFile, setIsDroppingFile] = useState(false);
  const queryClient = useQueryClient();

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 400);
  };

  const params = { ...(debouncedSearch ? { search: debouncedSearch } : {}), trashed: false };
  const { data, isLoading } = useListPhotos(params as any, {
    query: { queryKey: getListPhotosQueryKey(params as any) },
  });

  const photos = data?.photos ?? [];

  const handleGlobalDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDroppingFile(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      await fetch(`${API_BASE}/photos`, { method: "POST", body: formData, credentials: "include" });
    }
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
  }, [queryClient]);

  return (
    <div
      className="flex-1 flex flex-col h-full"
      onDragOver={e => { e.preventDefault(); setIsDroppingFile(true); }}
      onDragLeave={() => setIsDroppingFile(false)}
      onDrop={handleGlobalDrop}
    >
      {isDroppingFile && (
        <div className="fixed inset-0 z-40 bg-primary/10 border-4 border-dashed border-primary flex items-center justify-center pointer-events-none">
          <p className="text-xl font-semibold text-primary">Drop photos to upload</p>
        </div>
      )}

      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-foreground">Photos</h1>
        <div className="flex-1" />
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search photos..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            data-testid="input-search"
            className="w-full pl-9 pr-8 py-2 text-sm bg-muted rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground"
          />
          {search && (
            <button onClick={() => handleSearchChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-sm" />
            ))}
          </div>
        ) : (
          <PhotoGrid
            photos={photos}
            emptyMessage={search ? "No photos match your search" : "Upload your first photo using the button in the sidebar or by dropping files here"}
          />
        )}
      </div>
    </div>
  );
}
