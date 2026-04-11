import { useRoute } from "wouter";
import { useGetSharedPhoto, getGetSharedPhotoQueryKey } from "@workspace/api-client-react";
import { formatBytes, formatDate } from "@/lib/api";
import { Calendar, FileImage } from "lucide-react";

export default function SharePage() {
  const [, params] = useRoute("/share/:token");
  const token = params?.token ?? "";

  const { data, isLoading, error } = useGetSharedPhoto(token, {
    query: { queryKey: getGetSharedPhotoQueryKey(token), enabled: !!token },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <FileImage className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-foreground mb-1">Link expired or not found</h2>
          <p className="text-sm text-muted-foreground">This share link may have expired or been removed.</p>
        </div>
      </div>
    );
  }

  const photo = data.photo;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 py-4 border-b border-border flex items-center gap-3">
        <div className="w-7 h-7 rounded-lg bg-primary/15 flex items-center justify-center">
          <FileImage className="w-4 h-4 text-primary" />
        </div>
        <span className="text-sm font-semibold text-foreground">My Photos</span>
        <span className="text-xs text-muted-foreground ml-auto">Shared photo</span>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6">
        <div className="w-full max-w-2xl">
          <img
            src={photo.url}
            alt={photo.filename}
            className="w-full max-h-[65vh] object-contain rounded-xl shadow-lg"
            data-testid="shared-photo-image"
          />
        </div>
        <div className="text-center space-y-1">
          <p className="text-base font-medium text-foreground">{photo.filename}</p>
          <div className="flex items-center justify-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><Calendar className="w-3.5 h-3.5" />{formatDate(photo.uploadedAt)}</span>
            {photo.size && <span>{formatBytes(photo.size)}</span>}
          </div>
          {data.expiresAt && (
            <p className="text-xs text-muted-foreground">Link expires {formatDate(data.expiresAt.toString())}</p>
          )}
        </div>
        <a
          href={photo.url}
          download={photo.filename}
          target="_blank"
          rel="noreferrer"
          className="px-6 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Download
        </a>
      </div>
    </div>
  );
}
