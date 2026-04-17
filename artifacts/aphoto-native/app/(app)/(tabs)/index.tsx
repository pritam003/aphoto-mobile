import { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useListPhotos, getListPhotosQueryKey } from "@workspace/api-client-react";
import PhotoGrid from "../../components/PhotoGrid";
import Lightbox from "../../components/Lightbox";
import UploadSheet from "../../components/UploadSheet";
import GoogleImportSheet from "../../components/GoogleImportSheet";
import SideMenu from "../../components/SideMenu";

export default function LibraryScreen() {
  const queryClient = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);

  const { data, isLoading, isRefetching, refetch } = useListPhotos(
    { trashed: false, hidden: false, limit: 500 },
    { query: { staleTime: 2 * 60 * 1000 } }
  );

  const photos = data?.photos ?? [];

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
  }, [queryClient]);

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <TouchableOpacity onPress={() => setMenuVisible(true)} hitSlop={8}>
          <Ionicons name="menu-outline" size={26} color="#f9fafb" />
        </TouchableOpacity>
        <Text className="text-foreground text-xl font-bold">Library</Text>
        <Text className="text-muted text-sm">{photos.length}</Text>
      </View>

      {/* Content */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={handleRefresh}
              tintColor="#3b82f6"
            />
          }
        >
          <PhotoGrid
            photos={photos}
            onPhotoPress={(_, index) => setLightboxIndex(index)}
            dateField="taken"
            emptyMessage="No photos yet. Tap + to upload."
          />
        </ScrollView>
      )}

      {/* FAB */}
      <View className="absolute bottom-6 right-6" style={{ zIndex: 50 }}>
        {fabOpen && (
          <View className="mb-3 gap-2">
            <TouchableOpacity
              onPress={() => { setFabOpen(false); setImportVisible(true); }}
              className="bg-surface border border-border rounded-xl px-4 py-3 flex-row items-center gap-3"
            >
              <Ionicons name="logo-google" size={18} color="#4285f4" />
              <Text className="text-foreground text-sm">Import from Google Photos</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setFabOpen(false); setUploadVisible(true); }}
              className="bg-surface border border-border rounded-xl px-4 py-3 flex-row items-center gap-3"
            >
              <Ionicons name="phone-portrait-outline" size={18} color="#3b82f6" />
              <Text className="text-foreground text-sm">Upload from phone</Text>
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity
          onPress={() => setFabOpen(o => !o)}
          className="w-14 h-14 bg-primary rounded-full items-center justify-center shadow-lg"
        >
          <Ionicons name={fabOpen ? "close" : "add"} size={28} color="white" />
        </TouchableOpacity>
      </View>

      {lightboxIndex !== null && (
        <Lightbox
          photos={photos}
          initialIndex={lightboxIndex}
          visible
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <UploadSheet
        visible={uploadVisible}
        onClose={() => setUploadVisible(false)}
        onDone={() => {
          setUploadVisible(false);
          handleRefresh();
        }}
      />

      <GoogleImportSheet
        visible={importVisible}
        onClose={() => setImportVisible(false)}
        onDone={() => {
          setImportVisible(false);
          handleRefresh();
        }}
      />

      <SideMenu visible={menuVisible} onClose={() => setMenuVisible(false)} />
    </SafeAreaView>
  );
}
