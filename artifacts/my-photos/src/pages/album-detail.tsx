import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Pencil, Check, Upload, Plus, X } from "lucide-react";
import GoogleImportModal from "@/components/GoogleImportModal";
import { useState } from "react";
import { useGetAlbum, useListAlbumPhotos, useUpdateAlbum, useListPhotos, useAddPhotoToAlbum, useRemovePhotoFromAlbum, useTrashPhoto, getListAlbumsQueryKey, getListAlbumPhotosQueryKey, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import PhotoGrid from "@/components/PhotoGrid";
import UploadModal from "@/components/UploadModal";
import { useImport } from "@/lib/importContext";

export default function AlbumDetailPage() {
  const [, params] = useRoute("/albums/:id");
  const id = params?.id ?? "";
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showGoogleImport, setShowGoogleImport] = useState(false);
  const [sortOrder, setSortOrder] = useState<"taken" | "uploaded">("taken");
  const queryClient = useQueryClient();

  const { activeImportAlbumId } = useImport();

  const { data: album } = useGetAlbum(id, {
    query: { queryKey: ["album", id], enabled: !!id },
  });
  const { data, isLoading } = useListAlbumPhotos(id, {
    query: {
      queryKey: getListAlbumPhotosQueryKey(id),
      enabled: !!id,
      refetchInterval: activeImportAlbumId === id ? 3000 : false,
    },
  });
  const { data: allPhotosData } = useListPhotos({}, {
    query: { queryKey: ["all-photos-for-picker"], enabled: showPicker },
  });
  const updateAlbum = useUpdateAlbum();
  const addPhoto = useAddPhotoToAlbum();
  const removePhoto = useRemovePhotoFromAlbum();
  const trashPhoto = useTrashPhoto();

  const photos = (data?.photos ?? []).slice().sort((a: any, b: any) => {
    if (sortOrder === "uploaded") {
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    }
    const da = new Date(a.takenAt ?? a.uploadedAt).getTime();
    const db2 = new Date(b.takenAt ?? b.uploadedAt).getTime();
    return db2 - da;
  });
  const albumPhotoIds = new Set(photos.map((p: any) => p.id));
  const libraryPhotos = (allPhotosData?.photos ?? []).filter((p: any) => !albumPhotoIds.has(p.id));

  const startEdit = () => {
    setEditName(album?.name ?? "");
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editName.trim()) return;
    await updateAlbum.mutateAsync({ id, data: { name: editName.trim() } });
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
    setEditing(false);
  };

  const handleAddExisting = async (photoId: string) => {
    await addPhoto.mutateAsync({ id, data: { photoId } });
    queryClient.invalidateQueries({ queryKey: getListAlbumPhotosQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
  };

  const handleRemoveFromAlbum = async (photoId: string) => {
    // Remove from cache first so UI updates immediately
    queryClient.setQueryData(getListAlbumPhotosQueryKey(id), (old: any) => {
      if (!old) return old;
      return { ...old, photos: old.photos.filter((p: any) => p.id !== photoId) };
    });
    await removePhoto.mutateAsync({ id, photoId });
    // Invalidate after mutation so cover photo etc. updates in background
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
  };

  const handleTrash = async (photoId: string) => {
    // Remove from cache first so UI updates immediately
    queryClient.setQueryData(getListAlbumPhotosQueryKey(id), (old: any) => {
      if (!old) return old;
      return { ...old, photos: old.photos.filter((p: any) => p.id !== photoId) };
    });
    await trashPhoto.mutateAsync({ id: photoId, data: { trashed: true } });
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAlbumPhotosQueryKey(id) });
  };

  const handleBulkTrash = async (ids: string[]) => {
    queryClient.setQueryData(getListAlbumPhotosQueryKey(id), (old: any) => {
      if (!old) return old;
      return { ...old, photos: old.photos.filter((p: any) => !ids.includes(p.id)) };
    });
    await Promise.all(ids.map(photoId => trashPhoto.mutateAsync({ id: photoId, data: { trashed: true } })));
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListAlbumPhotosQueryKey(id) });
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <button onClick={() => navigate("/albums")} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </button>
        {editing ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              autoFocus
              className="text-lg font-semibold bg-transparent border-b-2 border-primary outline-none text-foreground"
              onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false); }}
            />
            <button onClick={saveEdit} className="p-1 text-primary"><Check className="w-4 h-4" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1">
            <h1 className="text-lg font-semibold text-foreground">{album?.name}</h1>
            <button onClick={startEdit} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        <span className="text-sm text-muted-foreground">{photos.length} photo{photos.length !== 1 ? "s" : ""}</span>
        <select
          value={sortOrder}
          onChange={e => setSortOrder(e.target.value as "taken" | "uploaded")}
          className="text-xs px-2 py-1.5 rounded-md border border-border bg-background text-foreground cursor-pointer"
        >
          <option value="taken">Date taken</option>
          <option value="uploaded">Date added</option>
        </select>
        <button
          onClick={() => setShowPicker(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
        >
          <Plus className="w-4 h-4" /> Add existing
        </button>
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
        <button
          onClick={() => setShowUpload(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Upload className="w-4 h-4" /> Upload
        </button>
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
            dateField={sortOrder}
            emptyMessage="No photos in this album yet. Upload or add existing photos."
            onRemoveFromAlbum={handleRemoveFromAlbum}
            onTrash={handleTrash}
            onBulkTrash={handleBulkTrash}
          />
        )}
      </div>

      {showUpload && (
        <UploadModal
          onClose={() => setShowUpload(false)}
          albumId={id}
          albumName={album?.name}
        />
      )}

      {showGoogleImport && (
        <GoogleImportModal
          onClose={() => setShowGoogleImport(false)}
          targetAlbumId={id}
          albumDisplayName={album?.name ?? ""}
          onDone={() => queryClient.invalidateQueries({ queryKey: getListAlbumPhotosQueryKey(id) })}
        />
      )}

      {showPicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-foreground">Add photos to "{album?.name}"</h2>
              <button onClick={() => setShowPicker(false)} className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {libraryPhotos.length === 0 ? (
                <p className="text-center text-muted-foreground py-12">All your photos are already in this album.</p>
              ) : (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                  {libraryPhotos.map((photo: any) => (
                    <button
                      key={photo.id}
                      onClick={() => handleAddExisting(photo.id)}
                      className="relative aspect-square rounded-lg overflow-hidden bg-muted group hover:ring-2 hover:ring-primary transition-all"
                    >
                      <img src={photo.thumbnailUrl || photo.url} alt={photo.filename} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center">
                        <Plus className="w-6 h-6 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="px-6 py-3 border-t border-border">
              <button onClick={() => setShowPicker(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
