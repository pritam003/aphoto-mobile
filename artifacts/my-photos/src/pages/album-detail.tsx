import { useRoute, useLocation } from "wouter";
import { ArrowLeft, Pencil, Check, Upload, Plus, X } from "lucide-react";
import { useState } from "react";
import { useGetAlbum, useListAlbumPhotos, useUpdateAlbum, useListPhotos, useAddPhotoToAlbum, useRemovePhotoFromAlbum, useTrashPhoto, getListAlbumsQueryKey, getListAlbumPhotosQueryKey, getListPhotosQueryKey, getGetPhotoStatsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import PhotoGrid from "@/components/PhotoGrid";
import UploadModal from "@/components/UploadModal";

export default function AlbumDetailPage() {
  const [, params] = useRoute("/albums/:id");
  const id = params?.id ?? "";
  const [, navigate] = useLocation();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [sortOrder, setSortOrder] = useState<"taken" | "uploaded">("taken");
  const queryClient = useQueryClient();

  const { data: album } = useGetAlbum(id, {
    query: { queryKey: ["album", id], enabled: !!id },
  });
  const { data, isLoading } = useListAlbumPhotos(id, {
    query: { queryKey: getListAlbumPhotosQueryKey(id), enabled: !!id },
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
