import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Search, X, Sparkles } from "lucide-react";
import { useListPhotos, getListPhotosQueryKey } from "@workspace/api-client-react";
import PhotoGrid from "@/components/PhotoGrid";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { API_BASE } from "@/lib/api";
import GoogleImportModal from "@/components/GoogleImportModal";

const PAGE_SIZE = 50;

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [isDroppingFile, setIsDroppingFile] = useState(false);
  const [offset, setOffset] = useState(0);
  const [allPhotos, setAllPhotos] = useState<any[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [sortOrder, setSortOrder] = useState<"taken" | "uploaded">("taken");
  const [showGoogleImport, setShowGoogleImport] = useState(false);
  const [dismissedOnThisDay, setDismissedOnThisDay] = useState(false);
  const queryClient = useQueryClient();

  // "On this day" — photos from the same calendar day in prior years
  const onThisDayPhotos = useMemo(() => {
    if (!allPhotos.length) return [];
    const now = new Date();
    const todayMonth = now.getMonth();
    const todayDay = now.getDate();
    const thisYear = now.getFullYear();
    return allPhotos.filter(p => {
      const d = new Date(p.takenAt ?? p.uploadedAt);
      return d.getMonth() === todayMonth && d.getDate() === todayDay && d.getFullYear() < thisYear;
    });
  }, [allPhotos]);

  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setOffset(0);
      setAllPhotos([]);
      setHasMore(true);
    }, 400);
  };

  const handleSortChange = (order: "taken" | "uploaded") => {
    if (order === sortOrder) return;
    setSortOrder(order);
    setOffset(0);
    setAllPhotos([]);
    setHasMore(true);
    queryClient.removeQueries({ queryKey: getListPhotosQueryKey() });
  };

  const params = { ...(debouncedSearch ? { search: debouncedSearch } : {}), trashed: false, hidden: false, orderBy: sortOrder, limit: PAGE_SIZE, offset };
  const { data, isLoading, isFetching } = useListPhotos(params as any, {
    query: { queryKey: getListPhotosQueryKey(params as any) },
  });

  useEffect(() => {
    if (!data) return;
    const incoming = (data as any).photos ?? [];
    if (offset === 0) {
      setAllPhotos(incoming);
    } else {
      setAllPhotos(prev => [...prev, ...incoming]);
    }
    setHasMore((data as any).hasMore ?? incoming.length === PAGE_SIZE);
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetList = () => {
    setOffset(0);
    setAllPhotos([]);
    setHasMore(true);
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
  };

  const handleHidePhoto = async (id: string) => {
    await fetch(`${API_BASE}/photos/${id}/hide`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ hidden: true }),
    });
    resetList();
  };

  const handleGlobalDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDroppingFile(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith("image/") || f.type.startsWith("video/"));
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      await fetch(`${API_BASE}/photos`, { method: "POST", body: formData, credentials: "include" });
    }
    resetList();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-border bg-background/90 backdrop-blur sticky top-0 z-10 shadow-sm">
        <h1 className="text-lg font-bold text-foreground tracking-tight">Photos</h1>
        <div className="flex-1" />
        <button
          onClick={() => setShowGoogleImport(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          Import from Google
        </button>
        <select
          value={sortOrder}
          onChange={e => handleSortChange(e.target.value as "taken" | "uploaded")}
          className="text-xs px-2.5 py-1.5 rounded-lg border border-border bg-muted text-foreground cursor-pointer hover:bg-muted/80 transition-colors"
        >
          <option value="taken">Date taken</option>
          <option value="uploaded">Date added</option>
        </select>
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search photos..."
            value={search}
            onChange={e => handleSearchChange(e.target.value)}
            data-testid="input-search"
            className="w-full pl-8 pr-8 py-1.5 text-sm bg-muted rounded-xl border border-transparent focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/40 placeholder:text-muted-foreground transition-all"
          />
          {search && (
            <button onClick={() => handleSearchChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {showGoogleImport && (
        <GoogleImportModal onClose={() => setShowGoogleImport(false)} />
      )}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading && offset === 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-sm" />
            ))}
          </div>
        ) : (
          <>
            {/* On This Day banner */}
            {onThisDayPhotos.length > 0 && !dismissedOnThisDay && !search && (
              <div className="mb-6 rounded-2xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-primary" />
                    <span className="text-sm font-semibold text-foreground">On this day</span>
                    <span className="text-xs text-muted-foreground">— {new Date().toLocaleDateString("en-US", { month: "long", day: "numeric" })} in past years</span>
                  </div>
                  <button onClick={() => setDismissedOnThisDay(true)} className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex gap-2 overflow-x-auto p-3 scrollbar-none">
                  {onThisDayPhotos.map(p => (
                    <div key={p.id} className="relative shrink-0 w-28 h-28 rounded-xl overflow-hidden bg-muted group">
                      <img src={p.thumbnailUrl || p.url} alt={p.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 py-1">
                        <span className="text-white text-[10px] font-medium">{new Date(p.takenAt ?? p.uploadedAt).getFullYear()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <PhotoGrid
              photos={allPhotos}
              dateField={sortOrder}
              onHide={handleHidePhoto}
              emptyMessage={search ? "No photos match your search" : "Upload your first photo using the button in the sidebar or by dropping files here"}
            />
            {hasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={() => setOffset(prev => prev + PAGE_SIZE)}
                  disabled={isFetching}
                  className="px-6 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {isFetching ? "Loading..." : `Load more`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
