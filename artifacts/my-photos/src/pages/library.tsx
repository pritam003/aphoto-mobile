import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Search, X, ImageIcon } from "lucide-react";
import { useListPhotos, getListPhotosQueryKey } from "@workspace/api-client-react";
import PhotoGrid from "@/components/PhotoGrid";
import { useQueryClient } from "@tanstack/react-query";
import { getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { API_BASE } from "@/lib/api";
import GoogleImportModal from "@/components/GoogleImportModal";
import OnThisDayReel from "@/components/OnThisDayReel";

const SEARCH_PAGE_SIZE = 50;

function formatMonthLabel(yearMonth: string) {
  const [y, m] = yearMonth.split("-");
  return new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function LibraryPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const [isDroppingFile, setIsDroppingFile] = useState(false);
  const [sortOrder, setSortOrder] = useState<"taken" | "uploaded">("taken");
  const [showGoogleImport, setShowGoogleImport] = useState(false);
  const [memoryDays, setMemoryDays] = useState<any[]>([]);
  const [memoryTodayDow, setMemoryTodayDow] = useState<number>(new Date().getDay());
  const queryClient = useQueryClient();

  // ── Month-based state (non-search mode) ────────────────────────────────────
  const [monthsList, setMonthsList] = useState<{ yearMonth: string; count: number; covers: string[] }[]>([]);
  const [photosByMonth, setPhotosByMonth] = useState<Record<string, any[]>>({});
  const [loadingMonth, setLoadingMonth] = useState<string | null>(null);
  const [monthsLoading, setMonthsLoading] = useState(true);

  // ── Search fallback state ──────────────────────────────────────────────────
  const [searchOffset, setSearchOffset] = useState(0);
  const [searchPhotos, setSearchPhotos] = useState<any[]>([]);
  const [searchHasMore, setSearchHasMore] = useState(false);

  // ── Memories ───────────────────────────────────────────────────────────────
  const refreshMemories = useCallback(() => {
    fetch(`${API_BASE}/photos/on-this-day`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { days: [], todayDow: new Date().getDay() })
      .then(d => { setMemoryDays(d.days ?? []); setMemoryTodayDow(d.todayDow ?? new Date().getDay()); })
      .catch(() => {});
  }, []);

  useEffect(() => { refreshMemories(); }, [refreshMemories]);

  // ── Load months index ──────────────────────────────────────────────────────
  const fetchMonthsList = useCallback(() => {
    setMonthsLoading(true);
    fetch(`${API_BASE}/photos/months`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { months: [] })
      .then(d => {
        const months: { yearMonth: string; count: number }[] = d.months ?? [];
        setMonthsList(months);
        // Auto-load the most recent month
        if (months.length > 0) loadMonth(months[0].yearMonth);
        setMonthsLoading(false);
      })
      .catch(() => setMonthsLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchMonthsList(); }, [fetchMonthsList]);

  const loadMonth = useCallback((yearMonth: string) => {
    setLoadingMonth(yearMonth);
    fetch(`${API_BASE}/photos?trashed=false&hidden=false&month=${yearMonth}&limit=500&offset=0&orderBy=taken`, { credentials: "include" })
      .then(r => r.ok ? r.json() : { photos: [] })
      .then(d => {
        setPhotosByMonth(prev => ({ ...prev, [yearMonth]: d.photos ?? [] }));
        setLoadingMonth(null);
      })
      .catch(() => setLoadingMonth(null));
  }, []);

  // Merge all loaded months into one sorted array for PhotoGrid (search only)
  const allPhotos = useMemo(() => {
    const sorted = Object.keys(photosByMonth).sort((a, b) => b.localeCompare(a));
    return sorted.flatMap(m => photosByMonth[m]);
  }, [photosByMonth]);

  // Sorted list of loaded months (newest first)
  const loadedMonths = useMemo(
    () => Object.keys(photosByMonth).sort((a, b) => b.localeCompare(a)),
    [photosByMonth],
  );

  const collapseMonth = useCallback((yearMonth: string) => {
    setPhotosByMonth(prev => {
      const next = { ...prev };
      delete next[yearMonth];
      return next;
    });
  }, []);

  // Which months are not yet loaded
  const unloadedMonths = useMemo(
    () => monthsList.filter(m => !(m.yearMonth in photosByMonth) && m.yearMonth !== loadingMonth),
    [monthsList, photosByMonth, loadingMonth],
  );

  // ── Search via existing hook ───────────────────────────────────────────────
  const searchParams = { search: debouncedSearch, trashed: false, hidden: false, orderBy: sortOrder, limit: SEARCH_PAGE_SIZE, offset: searchOffset };
  const { data: searchData, isLoading: searchLoading, isFetching: searchFetching } = useListPhotos(
    searchParams as any,
    { query: { enabled: !!debouncedSearch, queryKey: getListPhotosQueryKey(searchParams as any) } },
  );

  useEffect(() => {
    if (!searchData || !debouncedSearch) return;
    const incoming = (searchData as any).photos ?? [];
    if (searchOffset === 0) setSearchPhotos(incoming);
    else setSearchPhotos(prev => [...prev, ...incoming]);
    setSearchHasMore((searchData as any).hasMore ?? incoming.length === SEARCH_PAGE_SIZE);
  }, [searchData]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleSearchChange = (val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(val);
      setSearchOffset(0);
      setSearchPhotos([]);
    }, 400);
  };

  const handleSortChange = (order: "taken" | "uploaded") => {
    if (order === sortOrder) return;
    setSortOrder(order);
    // Re-fetch all loaded months with new sort
    setPhotosByMonth({});
    fetchMonthsList();
    queryClient.removeQueries({ queryKey: getListPhotosQueryKey() });
  };

  const resetList = () => {
    setPhotosByMonth({});
    setMonthsList([]);
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
    refreshMemories();
    fetchMonthsList();
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

  const isInitialLoading = monthsLoading && Object.keys(photosByMonth).length === 0 && !debouncedSearch;
  const displayPhotos = debouncedSearch ? searchPhotos : allPhotos;
  // First loaded month is auto-loaded and cannot be collapsed
  const firstMonth = monthsList[0]?.yearMonth;

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

      {showGoogleImport && <GoogleImportModal onClose={() => setShowGoogleImport(false)} />}

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isInitialLoading || (debouncedSearch && searchLoading && searchOffset === 0) ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-1">
            {Array.from({ length: 18 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-sm" />
            ))}
          </div>
        ) : (
          <>
            {/* Weekly memories strip — only in non-search mode */}
            {memoryDays.length > 0 && !debouncedSearch && (
              <OnThisDayReel days={memoryDays} todayDow={memoryTodayDow} />
            )}

            {/* Month cards grid — 3 per row; clicking a tile expands photos below that row */}
            {!debouncedSearch && (() => {
              // Chunk monthsList into rows of 3 (matches lg:grid-cols-3)
              const rows: typeof monthsList[] = [];
              for (let i = 0; i < monthsList.length; i += 3) {
                rows.push(monthsList.slice(i, i + 3));
              }
              return rows.map((row, rowIdx) => {
                const expandedInRow = row.filter(m => m.yearMonth in photosByMonth);
                return (
                  <React.Fragment key={rowIdx}>
                    {/* Card row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                      {row.map((m) => {
                        const isLoaded = m.yearMonth in photosByMonth;
                        const isLoading = loadingMonth === m.yearMonth;
                        return (
                          <button
                            key={m.yearMonth}
                            onClick={() => isLoaded ? collapseMonth(m.yearMonth) : loadMonth(m.yearMonth)}
                            disabled={isLoading}
                            className={`group relative rounded-2xl overflow-hidden border bg-muted/20 hover:shadow-md transition-all text-left disabled:opacity-70 ${isLoaded ? 'border-primary/40 ring-2 ring-primary/20' : 'border-border hover:border-primary/30'}`}
                          >
                            <div className="grid grid-cols-2 gap-0.5 h-36">
                              {m.covers.length >= 4 ? (
                                m.covers.map((src, i) => (
                                  <img key={i} src={src} className="w-full h-full object-cover" />
                                ))
                              ) : m.covers.length > 0 ? (
                                <img src={m.covers[0]} className="col-span-2 w-full h-full object-cover" />
                              ) : (
                                <div className="col-span-2 w-full h-full bg-muted flex items-center justify-center">
                                  <ImageIcon className="w-8 h-8 text-muted-foreground/30" />
                                </div>
                              )}
                            </div>
                            <div className="flex items-center justify-between px-3.5 py-2.5">
                              <div>
                                <p className="text-sm font-semibold text-foreground">{formatMonthLabel(m.yearMonth)}</p>
                                <p className="text-xs text-muted-foreground">{m.count.toLocaleString()} {m.count === 1 ? "photo" : "photos"}</p>
                              </div>
                              {isLoading ? (
                                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                              ) : isLoaded ? (
                                <span className="text-[11px] font-medium text-muted-foreground">Hide ↑</span>
                              ) : (
                                <span className="text-[11px] font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">Load</span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    {/* Expanded photo grids for any clicked tile in this row */}
                    {expandedInRow.map(m => (
                      <div key={m.yearMonth} className="mb-6">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-baseline gap-2">
                            <h2 className="text-base font-bold text-foreground">{formatMonthLabel(m.yearMonth)}</h2>
                            <span className="text-xs text-muted-foreground">
                              {photosByMonth[m.yearMonth].length.toLocaleString()} photos
                            </span>
                          </div>
                          <button
                            onClick={() => collapseMonth(m.yearMonth)}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
                          >
                            Show less
                          </button>
                        </div>
                        <PhotoGrid
                          photos={photosByMonth[m.yearMonth]}
                          dateField={sortOrder}
                          onHide={handleHidePhoto}
                          emptyMessage=""
                        />
                      </div>
                    ))}
                  </React.Fragment>
                );
              });
            })()}

            {/* Search results */}
            {debouncedSearch && (
              <PhotoGrid
                photos={displayPhotos}
                dateField={sortOrder}
                onHide={handleHidePhoto}
                emptyMessage="No photos match your search"
              />
            )}

            {/* Search pagination */}
            {debouncedSearch && searchHasMore && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={() => setSearchOffset(prev => prev + SEARCH_PAGE_SIZE)}
                  disabled={searchFetching}
                  className="px-6 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {searchFetching ? "Loading..." : "Load more results"}
                </button>
              </div>
            )}

            {/* Unloaded months section removed — now unified above */}
          </>
        )}
      </div>
    </div>
  );
}

