import { useCallback, useMemo } from "react";
import { View, Text, SectionList } from "react-native";
import { FlashList } from "@shopify/flash-list";
import PhotoTile, { TILE_SIZE } from "./PhotoTile";

interface Photo {
  id: string;
  thumbnailUrl?: string | null;
  takenAt?: string | null;
  uploadedAt?: string | null;
}

interface Props {
  photos: Photo[];
  onPhotoPress: (photo: Photo, index: number) => void;
  onPhotoLongPress?: (photo: Photo) => void;
  selectedIds?: Set<string>;
  dateField?: "taken" | "uploaded";
  emptyMessage?: string;
}

interface Section {
  title: string;
  data: Photo[][];
}

const COLS = 3;

function groupByMonth(photos: Photo[], dateField: "taken" | "uploaded"): Section[] {
  const map = new Map<string, Photo[]>();
  for (const p of photos) {
    const raw = dateField === "taken" ? p.takenAt : p.uploadedAt;
    const key = raw
      ? new Date(raw).toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : "Unknown date";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }

  return Array.from(map.entries()).map(([title, items]) => {
    // Chunk photos into rows of COLS
    const rows: Photo[][] = [];
    for (let i = 0; i < items.length; i += COLS) {
      rows.push(items.slice(i, i + COLS));
    }
    return { title, data: rows };
  });
}

export default function PhotoGrid({
  photos,
  onPhotoPress,
  onPhotoLongPress,
  selectedIds,
  dateField = "taken",
  emptyMessage = "No photos",
}: Props) {
  const sections = useMemo(() => groupByMonth(photos, dateField), [photos, dateField]);

  // Flat index for lightbox navigation
  const flatIndex = useMemo(() => {
    const map = new Map<string, number>();
    photos.forEach((p, i) => map.set(p.id, i));
    return map;
  }, [photos]);

  if (photos.length === 0) {
    return (
      <View className="flex-1 items-center justify-center">
        <Text className="text-muted text-base">{emptyMessage}</Text>
      </View>
    );
  }

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row, idx) => row.map(p => p.id).join("_") + idx}
      renderSectionHeader={({ section }) => (
        <View className="px-3 py-2 bg-background">
          <Text className="text-foreground font-semibold text-sm">{section.title}</Text>
        </View>
      )}
      renderItem={({ item: row }) => (
        <View className="flex-row" style={{ gap: 2 }}>
          {row.map((photo) => (
            <PhotoTile
              key={photo.id}
              photoId={photo.id}
              thumbnailUrl={photo.thumbnailUrl}
              isSelected={selectedIds?.has(photo.id)}
              onPress={() => onPhotoPress(photo, flatIndex.get(photo.id) ?? 0)}
              onLongPress={() => onPhotoLongPress?.(photo)}
            />
          ))}
          {/* Fill empty slots in last row */}
          {row.length < COLS &&
            Array.from({ length: COLS - row.length }).map((_, i) => (
              <View key={`empty-${i}`} style={{ width: TILE_SIZE, height: TILE_SIZE, margin: 1 }} />
            ))}
        </View>
      )}
      stickySectionHeadersEnabled
      showsVerticalScrollIndicator={false}
    />
  );
}
