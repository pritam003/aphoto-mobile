const _apiOrigin = import.meta.env.VITE_API_URL || "";
export const API_BASE = `${_apiOrigin}/api`;

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function groupPhotosByDate(photos: any[], dateField: "taken" | "uploaded" = "taken"): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  for (const photo of photos) {
    const date = dateField === "uploaded"
      ? new Date(photo.uploadedAt)
      : new Date(photo.takenAt ?? photo.uploadedAt);
    const key = date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    if (!groups[key]) groups[key] = [];
    groups[key].push(photo);
  }
  // Sort each month's photos newest-first using the same field
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => {
      const da = dateField === "uploaded"
        ? new Date(a.uploadedAt).getTime()
        : new Date(a.takenAt ?? a.uploadedAt).getTime();
      const db = dateField === "uploaded"
        ? new Date(b.uploadedAt).getTime()
        : new Date(b.takenAt ?? b.uploadedAt).getTime();
      return db - da;
    });
  }
  return groups;
}
