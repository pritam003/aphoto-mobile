import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPhotos,
  useTrashPhoto,
  getListPhotosQueryKey,
} from "@workspace/api-client-react";
import PhotoGrid from "../components/PhotoGrid";
import Lightbox from "../components/Lightbox";

export default function TrashScreen() {
  const queryClient = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const { data, isLoading, isRefetching } = useListPhotos(
    { trashed: true, limit: 500 },
    { query: { staleTime: 60_000 } }
  );
  const trashPhoto = useTrashPhoto();

  const photos = data?.photos ?? [];

  const handleRefresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
  }, [queryClient]);

  async function handleRestore(photoId: string) {
    await trashPhoto.mutateAsync({ id: photoId, data: { trashed: false } });
    handleRefresh();
  }

  function confirmEmptyTrash() {
    Alert.alert(
      "Empty trash?",
      `This will permanently delete ${photos.length} photo${photos.length !== 1 ? "s" : ""}. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete all",
          style: "destructive",
          onPress: async () => {
            // Delete each photo permanently via the generated client is not available in generated hooks,
            // so we call the raw API directly per-photo
            const apiUrl = (globalThis as any).__EXPO_API_URL__ ?? process.env.EXPO_PUBLIC_API_URL ?? "";
            for (const photo of photos) {
              await fetch(`${apiUrl}/api/photos/${photo.id}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${(globalThis as any).__EXPO_TOKEN__ ?? ""}` },
              });
            }
            handleRefresh();
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-foreground text-xl font-bold">Trash</Text>
        {photos.length > 0 && (
          <TouchableOpacity onPress={confirmEmptyTrash} hitSlop={8}>
            <Text className="text-destructive text-sm font-medium">Empty trash</Text>
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={handleRefresh} tintColor="#3b82f6" />
          }
        >
          <PhotoGrid
            photos={photos}
            onPhotoPress={(_, index) => setLightboxIndex(index)}
            emptyMessage="Trash is empty."
          />
        </ScrollView>
      )}

      {photos.length > 0 && !isLoading && (
        <View className="px-4 py-3 border-t border-border">
          <TouchableOpacity
            onPress={() => {
              Alert.alert("Restore all?", undefined, [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Restore",
                  onPress: async () => {
                    for (const p of photos) {
                      await trashPhoto.mutateAsync({ id: p.id, data: { trashed: false } });
                    }
                    handleRefresh();
                  },
                },
              ]);
            }}
            className="bg-primary rounded-xl py-3 items-center"
          >
            <Text className="text-white font-semibold">Restore all ({photos.length})</Text>
          </TouchableOpacity>
        </View>
      )}

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          visible
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </SafeAreaView>
  );
}
