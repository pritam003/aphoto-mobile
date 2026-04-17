import { useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  ActivityIndicator,
  FlatList,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useQueryClient } from "@tanstack/react-query";
import {
  useUploadPhoto,
  getListPhotosQueryKey,
  getGetPhotoStatsQueryKey,
} from "@workspace/api-client-react";

interface Props {
  visible: boolean;
  albumId?: string;
  onClose: () => void;
  onDone: () => void;
}

interface PickedAsset {
  uri: string;
  fileName: string | null;
  mimeType: string | null;
  width?: number;
  height?: number;
  exif?: Record<string, any> | null;
}

export default function UploadSheet({ visible, albumId, onClose, onDone }: Props) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"select" | "uploading">("select");
  const [assets, setAssets] = useState<PickedAsset[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const uploadPhoto = useUploadPhoto();

  const pickFromLibrary = useCallback(async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow access to your photo library in settings.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      exif: true,
      quality: 1,
    });
    if (!result.canceled && result.assets.length > 0) {
      setAssets(result.assets as PickedAsset[]);
    }
  }, []);

  const pickFromCamera = useCallback(async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow camera access in settings.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      exif: true,
      quality: 1,
    });
    if (!result.canceled && result.assets.length > 0) {
      setAssets(result.assets as PickedAsset[]);
    }
  }, []);

  const handleUpload = useCallback(async () => {
    if (assets.length === 0) return;
    setPhase("uploading");
    setProgress({ current: 0, total: assets.length });

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      try {
        const formData = new FormData();
        formData.append("file", {
          uri: asset.uri,
          name: asset.fileName ?? `photo_${Date.now()}.jpg`,
          type: asset.mimeType ?? "image/jpeg",
        } as any);

        // Extract taken-at from EXIF
        const takenAt =
          asset.exif?.DateTimeOriginal ??
          asset.exif?.DateTimeDigitized ??
          asset.exif?.CreateDate;
        if (takenAt) {
          formData.append("takenAt", new Date(takenAt).toISOString());
        }
        if (albumId) {
          formData.append("albumId", albumId);
        }

        await uploadPhoto.mutateAsync({ data: formData as any });
        setProgress(p => ({ ...p, current: i + 1 }));
      } catch {
        // Continue with remaining files even if one fails
      }
    }

    await queryClient.invalidateQueries({ queryKey: getListPhotosQueryKey() });
    await queryClient.invalidateQueries({ queryKey: getGetPhotoStatsQueryKey() });

    setAssets([]);
    setPhase("select");
    onDone();
  }, [assets, albumId, uploadPhoto, queryClient, onDone]);

  function handleClose() {
    if (phase === "uploading") return; // Prevent close while uploading
    setAssets([]);
    setPhase("select");
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <View className="flex-1 justify-end bg-black/60">
        <View className="bg-surface rounded-t-2xl p-5 gap-4" style={{ maxHeight: "80%" }}>
          {/* Handle */}
          <View className="w-10 h-1 bg-border rounded-full self-center" />

          {phase === "select" ? (
            <>
              <View className="flex-row items-center justify-between">
                <Text className="text-foreground text-lg font-semibold">Upload Photos</Text>
                <TouchableOpacity onPress={handleClose} hitSlop={8}>
                  <Ionicons name="close" size={22} color="#9ca3af" />
                </TouchableOpacity>
              </View>

              {assets.length === 0 ? (
                <View className="gap-3">
                  <TouchableOpacity
                    onPress={pickFromLibrary}
                    className="flex-row items-center gap-3 bg-background border border-border rounded-xl px-4 py-4"
                  >
                    <Ionicons name="images-outline" size={22} color="#3b82f6" />
                    <Text className="text-foreground text-base">Choose from library</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={pickFromCamera}
                    className="flex-row items-center gap-3 bg-background border border-border rounded-xl px-4 py-4"
                  >
                    <Ionicons name="camera-outline" size={22} color="#3b82f6" />
                    <Text className="text-foreground text-base">Take a photo</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <FlatList
                    data={assets}
                    horizontal
                    keyExtractor={(_, i) => String(i)}
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 6 }}
                    renderItem={({ item }) => (
                      <Image
                        source={{ uri: item.uri }}
                        style={{ width: 80, height: 80, borderRadius: 8 }}
                        contentFit="cover"
                      />
                    )}
                  />
                  <Text className="text-muted text-sm">{assets.length} file{assets.length > 1 ? "s" : ""} selected</Text>
                  <TouchableOpacity
                    onPress={handleUpload}
                    className="bg-primary rounded-xl py-3 items-center"
                  >
                    <Text className="text-white font-semibold">Upload {assets.length} file{assets.length > 1 ? "s" : ""}</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          ) : (
            <View className="items-center gap-4 py-6">
              <ActivityIndicator color="#3b82f6" size="large" />
              <Text className="text-foreground font-semibold">
                Uploading {progress.current} / {progress.total}…
              </Text>
              <View className="w-full bg-border rounded-full h-2">
                <View
                  className="bg-primary rounded-full h-2"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </View>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}
