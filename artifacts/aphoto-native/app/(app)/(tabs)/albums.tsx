import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListAlbums,
  useCreateAlbum,
  useDeleteAlbum,
  getListAlbumsQueryKey,
} from "@workspace/api-client-react";

export default function AlbumsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");

  const { data, isLoading } = useListAlbums({ query: { staleTime: 60_000 } });
  const createAlbum = useCreateAlbum();
  const deleteAlbum = useDeleteAlbum();

  const albums = Array.isArray(data) ? data : [];

  async function handleCreate() {
    if (!newName.trim()) return;
    await createAlbum.mutateAsync({ data: { name: newName.trim() } });
    await queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
    setNewName("");
    setShowCreate(false);
  }

  function handleDelete(id: string, name: string) {
    Alert.alert(`Delete "${name}"?`, "This will remove the album but not the photos.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          await deleteAlbum.mutateAsync({ id });
          queryClient.invalidateQueries({ queryKey: getListAlbumsQueryKey() });
        },
      },
    ]);
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-foreground text-xl font-bold">Albums</Text>
        <TouchableOpacity onPress={() => setShowCreate(true)} hitSlop={8}>
          <Ionicons name="add-circle-outline" size={26} color="#3b82f6" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : (
        <FlatList
          data={albums}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{ padding: 8, gap: 8 }}
          columnWrapperStyle={{ gap: 8 }}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <Text className="text-muted">No albums yet. Tap + to create one.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              onPress={() => router.push(`/(app)/albums/${item.id}`)}
              onLongPress={() => handleDelete(item.id, item.name)}
              className="flex-1 bg-surface rounded-xl overflow-hidden"
              activeOpacity={0.8}
            >
              {item.coverUrl ? (
                <Image
                  source={{ uri: item.coverUrl }}
                  style={{ width: "100%", aspectRatio: 1 }}
                  contentFit="cover"
                />
              ) : (
                <View
                  className="items-center justify-center bg-border"
                  style={{ aspectRatio: 1 }}
                >
                  <Ionicons name="images-outline" size={36} color="#6b7280" />
                </View>
              )}
              <View className="p-2">
                <Text className="text-foreground font-medium text-sm" numberOfLines={1}>
                  {item.name}
                </Text>
                <Text className="text-muted text-xs">{item.photoCount} photos</Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Create album modal */}
      <Modal visible={showCreate} transparent animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-surface rounded-t-2xl p-6 gap-4">
            <Text className="text-foreground text-lg font-semibold">New Album</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="Album name"
              placeholderTextColor="#6b7280"
              className="bg-background text-foreground rounded-xl px-4 py-3 border border-border"
              autoFocus
              onSubmitEditing={handleCreate}
            />
            <View className="flex-row gap-3">
              <TouchableOpacity
                onPress={() => { setShowCreate(false); setNewName(""); }}
                className="flex-1 bg-border rounded-xl py-3 items-center"
              >
                <Text className="text-foreground">Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleCreate}
                disabled={!newName.trim() || createAlbum.isPending}
                className="flex-1 bg-primary rounded-xl py-3 items-center"
              >
                {createAlbum.isPending ? (
                  <ActivityIndicator color="white" size="small" />
                ) : (
                  <Text className="text-white font-semibold">Create</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
