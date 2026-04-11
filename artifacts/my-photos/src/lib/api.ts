export const API_BASE = "/api";

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

export function groupPhotosByDate(photos: any[]): Record<string, any[]> {
  const groups: Record<string, any[]> = {};
  for (const photo of photos) {
    const date = new Date(photo.uploadedAt);
    const key = date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    if (!groups[key]) groups[key] = [];
    groups[key].push(photo);
  }
  return groups;
}
