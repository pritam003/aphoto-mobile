import { useState } from "react";
import { useListPhotos, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import PhotoGrid from "@/components/PhotoGrid";
import { API_BASE } from "@/lib/api";
import ArchiveLockGate, { type LockCtx } from "@/components/ArchiveLockGate";
import { Archive, Eye } from "lucide-react";

export default function ArchivePage() {
  return (
    <ArchiveLockGate>
      {(ctx) => <ArchiveInner {...ctx} />}
    </ArchiveLockGate>
  );
}

function ArchiveInner({ unlocked, locked, lockCard, manageLockBtn }: LockCtx) {
  const queryClient = useQueryClient();
  const params = { hidden: true, limit: 50 };
  const { data, isLoading } = useListPhotos(params as any, {
    query: { queryKey: getListPhotosQueryKey(params as any), enabled: unlocked },
  });

  const [unhidingAll, setUnhidingAll] = useState(false);
  const photos = unlocked ? (data?.photos ?? []) : [];

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
    setUnhidingAll(true);
    await Promise.all(photos.map(p => unhidePhoto(p.id)));
    setUnhidingAll(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full min-h-0">
      {/* Header — matches Albums / Library style */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <Archive className="w-5 h-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Archive</h1>

        {unlocked && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {isLoading ? "…" : `${photos.length} hidden`}
          </span>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-2">
          {unlocked && !isLoading && photos.length > 0 && (
            <button
              onClick={unhideAll}
              disabled={unhidingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted disabled:opacity-50 transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              {unhidingAll ? "Restoring…" : "Restore all"}
            </button>
          )}
          {manageLockBtn}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {!unlocked ? (
          /* Lock card centered — 0 photos shown until code is entered */
          <div className="flex items-center justify-center p-6 min-h-[60vh]">
            {lockCard}
          </div>
        ) : (
          <div className="px-6 py-5">
            <PhotoGrid
              photos={photos}
              emptyMessage="No hidden photos"
              onHide={unhidePhoto}
            />
          </div>
        )}
      </div>
    </div>
  );
}
