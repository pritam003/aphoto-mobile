import { useState } from "react";
import { Plus, BookImage, Pencil, Trash2 } from "lucide-react";
import { useListAlbums, useCreateAlbum, useDeleteAlbum, getListAlbumsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

export default function AlbumsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const queryClient = useQueryClient();

  const { data: albums, isLoading } = useListAlbums({
    query: { queryKey: getListAlbumsQueryKey() },
  });
  const createAlbum = useCreateAlbum();
  const deleteAlbum = useDeleteAlbum();

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await createAlbum.mutateAsync({ data: { name: name.trim() } });
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
    setName("");
    setShowCreate(false);
  };

  const handleDelete = async (id: string, albumName: string) => {
    if (!confirm(`Delete album "${albumName}"? Photos will not be deleted.`)) return;
    await deleteAlbum.mutateAsync({ id });
    queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
  };

  return (
    <div className="flex-1 flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-background/80 backdrop-blur sticky top-0 z-10">
        <h1 className="text-lg font-semibold text-foreground">Albums</h1>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(true)}
          data-testid="button-create-album"
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New album
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-square bg-muted animate-pulse rounded-xl" />
            ))}
          </div>
        ) : !albums || albums.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
            <BookImage className="w-12 h-12 mb-3 opacity-30" />
            <p>No albums yet</p>
            <button onClick={() => setShowCreate(true)} className="mt-3 text-sm text-primary hover:underline">Create your first album</button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {albums.map((album: any) => (
              <div key={album.id} className="group relative" data-testid={`album-${album.id}`}>
                <Link href={`/albums/${album.id}`}>
                  <a className="block">
                    <div className="aspect-square rounded-xl overflow-hidden bg-muted mb-2 relative">
                      {album.coverUrl ? (
                        <img src={album.coverUrl} alt={album.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookImage className="w-10 h-10 text-muted-foreground/40" />
                        </div>
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-xl" />
                    </div>
                    <p className="text-sm font-medium text-foreground truncate">{album.name}</p>
                    <p className="text-xs text-muted-foreground">{album.photoCount} photo{album.photoCount !== 1 ? "s" : ""}</p>
                  </a>
                </Link>
                <button
                  onClick={() => handleDelete(album.id, album.name)}
                  className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive/80"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-foreground mb-4">New Album</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <input
                type="text"
                placeholder="Album name"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
                data-testid="input-album-name"
                className="w-full px-3 py-2.5 text-sm bg-muted rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-muted-foreground"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors">
                  Cancel
                </button>
                <button type="submit" data-testid="button-save-album" className="px-4 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
