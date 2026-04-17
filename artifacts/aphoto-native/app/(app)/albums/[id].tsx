import { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Alert,
  TextInput,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAlbum,
  useListAlbumPhotos,
  useUpdateAlbum,
  getListAlbumPhotosQueryKey,
  getGetAlbumQueryKey,
} from "@workspace/api-client-react";
import PhotoGrid from "../../components/PhotoGrid";
import Lightbox from "../../components/Lightbox";
import GoogleImportSheet from "../../components/GoogleImportSheet";
import UploadSheet from "../../components/UploadSheet";

export default function AlbumDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [uploadVisible, setUploadVisible] = useState(false);
  const [importVisible, setImportVisible] = useState(false);

  const { data: album } = useGetAlbum(id ?? "", {
    query: { enabled: !!id },
  });
  const { data, isLoading } = useListAlbumPhotos(id ?? "", {
    query: { enabled: !!id, staleTime: 60_000 },
  });
  const updateAlbum = useUpdateAlbum();

  const photos = data?.photos ?? [];

  const handleRename = useCallback(async () => {
    if (!newName.trim() || !id) return;
    await updateAlbum.mutateAsync({ id, data: { name: newName.trim() } });
    queryClient.invalidateQueries({ queryKey: getGetAlbumQueryKey(id) });
    setRenaming(false);
  }, [id, newName, updateAlbum, queryClient]);

  const handleRefresh = useCallback(() => {
    if (!id) return;
    queryClient.invalidateQueries({ queryKey: getListAlbumPhotosQueryKey(id) });
  }, [id, queryClient]);

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      {/* Title + actions */}
      <View className="flex-row items-center justify-between px-4 py-2">
        <Text className="text-foreground font-semibold text-base flex-1" numberOfLines={1}>
          {album?.name ?? "Album"}
        </Text>
        <View className="flex-row gap-3">
          <TouchableOpacity onPress={() => { setNewName(album?.name ?? ""); setRenaming(true); }} hitSlop={8}>
            <Ionicons name="pencil-outline" size={20} color="#9ca3af" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setImportVisible(true)} hitSlop={8}>
            <Ionicons name="logo-google" size={20} color="#4285f4" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setUploadVisible(true)} hitSlop={8}>
            <Ionicons name="cloud-upload-outline" size={20} color="#3b82f6" />
          </TouchableOpacity>
        </View>
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
            dateField="uploaded"
            emptyMessage="No photos in this album."
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

      {/* Rename modal */}
      <Modal visible={renaming} transparent animationType="slide" onRequestClose={() => setRenaming(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-surface rounded-t-2xl p-6 gap-4">
            <Text className="text-foreground text-lg font-semibold">Rename Album</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholderTextColor="#6b7280"
              className="bg-background text-foreground rounded-xl px-4 py-3 border border-border"
              autoFocus
              onSubmitEditing={handleRename}
            />
            <View className="flex-row gap-3">
              <TouchableOpacity onPress={() => setRenaming(false)} className="flex-1 bg-border rounded-xl py-3 items-center">
                <Text className="text-foreground">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleRename} className="flex-1 bg-primary rounded-xl py-3 items-center">
                <Text className="text-white font-semibold">Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <UploadSheet
        visible={uploadVisible}
        albumId={id}
        onClose={() => setUploadVisible(false)}
        onDone={() => { setUploadVisible(false); handleRefresh(); }}
      />

      <GoogleImportSheet
        visible={importVisible}
        targetAlbumId={id}
        albumDisplayName={album?.name}
        onClose={() => setImportVisible(false)}
        onDone={() => { setImportVisible(false); handleRefresh(); }}
      />
    </SafeAreaView>
  );
}
