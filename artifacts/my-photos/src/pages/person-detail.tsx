import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Check, X, Trash2, User } from "lucide-react";
import { API_BASE } from "@/lib/api";
import Lightbox from "@/components/Lightbox";

interface PersonDetail {
  id: string;
  name: string | null;
  coverUrl: string | null;
  createdAt: string;
}

interface Photo {
  id: string;
  filename: string;
  contentType: string;
  url: string;
  thumbnailUrl: string;
  takenAt: string | null;
  uploadedAt: string;
  favorite: boolean;
}

async function fetchPersonDetail(id: string): Promise<{ person: PersonDetail; photos: Photo[]; hasMore: boolean }> {
  const res = await fetch(`${API_BASE}/people/${id}?limit=100`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch person");
  return res.json();
}

async function renamePerson(id: string, name: string): Promise<PersonDetail> {
  const res = await fetch(`${API_BASE}/people/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error("Failed to rename person");
  return res.json();
}

async function deletePerson(id: string): Promise<void> {
  const res = await fetch(`${API_BASE}/people/${id}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to delete person");
}

export default function PersonDetailPage() {
  const params = useParams<{ id: string }>();
  const personId = params.id;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["people", personId],
    queryFn: () => fetchPersonDetail(personId),
    staleTime: 2 * 60 * 1000,
  });

  const renameMutation = useMutation({
    mutationFn: (name: string) => renamePerson(personId, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["people"] });
      setEditingName(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deletePerson(personId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["people"] });
      navigate("/people");
    },
  });

  const person = data?.person;
  const photos = data?.photos ?? [];

  const handleStartEdit = () => {
    setNameInput(person?.name ?? "");
    setEditingName(true);
  };

  const handleSaveName = () => {
    if (nameInput.trim()) {
      renameMutation.mutate(nameInput.trim());
    }
  };

  const handleDelete = () => {
    if (confirm("Remove this person? Their photos won't be deleted.")) {
      deleteMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!person) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">Person not found.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background border-b border-border px-6 py-4">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/people")}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          {/* Avatar */}
          <div className="w-12 h-12 rounded-full overflow-hidden bg-muted flex-shrink-0">
            {person.coverUrl ? (
              <img src={person.coverUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/5">
                <User className="w-6 h-6 text-primary/40" />
              </div>
            )}
          </div>

          {/* Name / edit */}
          <div className="flex-1 min-w-0">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSaveName()}
                  className="text-xl font-semibold bg-transparent border-b border-primary outline-none w-full max-w-xs"
                  placeholder="Enter name…"
                />
                <button onClick={handleSaveName} className="p-1 text-primary hover:text-primary/80">
                  <Check className="w-4 h-4" />
                </button>
                <button onClick={() => setEditingName(false)} className="p-1 text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group">
                <h1 className="text-xl font-semibold truncate">
                  {person.name ?? "Unknown person"}
                </h1>
                <button
                  onClick={handleStartEdit}
                  className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-muted"
                  title="Rename"
                >
                  <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
            <p className="text-sm text-muted-foreground">{photos.length} photo{photos.length !== 1 ? "s" : ""}</p>
          </div>

          <button
            onClick={handleDelete}
            className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
            title="Remove person grouping"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Photo grid */}
      <div className="p-6">
        {photos.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-center text-muted-foreground">
            <User className="w-10 h-10 mb-3 opacity-40" />
            <p>No photos found for this person.</p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1">
            {photos.map((photo, idx) => (
              <button
                key={photo.id}
                onClick={() => setLightboxIndex(idx)}
                className="aspect-square overflow-hidden bg-muted hover:opacity-90 transition-opacity focus:outline-none focus:ring-2 focus:ring-primary rounded-sm"
              >
                <img
                  src={photo.thumbnailUrl}
                  alt={photo.filename}
                  loading="lazy"
                  className="w-full h-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos as any[]}
          initialIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </div>
  );
}
