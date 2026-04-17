import { useState } from "react";
import { View, Text, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useListPhotos } from "@workspace/api-client-react";
import PhotoGrid from "../../components/PhotoGrid";
import Lightbox from "../../components/Lightbox";

export default function FavoritesScreen() {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const { data, isLoading } = useListPhotos(
    { favorite: true, trashed: false, limit: 500 },
    { query: { staleTime: 2 * 60 * 1000 } }
  );

  const photos = data?.photos ?? [];

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-4 py-3">
        <Text className="text-foreground text-xl font-bold">Favorites</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : (
        <ScrollView className="flex-1">
          <PhotoGrid
            photos={photos}
            onPhotoPress={(_, index) => setLightboxIndex(index)}
            emptyMessage="No favorites yet. Heart a photo to add it here."
          />
        </ScrollView>
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
