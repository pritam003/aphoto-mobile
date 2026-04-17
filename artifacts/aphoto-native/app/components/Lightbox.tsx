import { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  Dimensions,
  ActivityIndicator,
  Share,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPhotoUrl,
  useToggleFavorite,
  useTrashPhoto,
  useCreateShare,
} from "@workspace/api-client-react";

interface Photo {
  id: string;
  filename?: string | null;
  thumbnailUrl?: string | null;
  isFavorite?: boolean;
  isTrashed?: boolean;
  takenAt?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
}

interface Props {
  photos: Photo[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

export default function Lightbox({ photos, initialIndex, visible, onClose }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (visible) setIndex(initialIndex);
  }, [visible, initialIndex]);

  const photo = photos[index];

  const { data: urlData } = useGetPhotoUrl(photo?.id ?? "", {
    query: { enabled: !!photo?.id && visible },
  });

  const toggleFav = useToggleFavorite();
  const trashPhoto = useTrashPhoto();
  const createShare = useCreateShare();

  const goBack = useCallback(() => {
    if (index > 0) setIndex(i => i - 1);
  }, [index]);

  const goForward = useCallback(() => {
    if (index < photos.length - 1) setIndex(i => i + 1);
  }, [index, photos.length]);

  async function handleFavorite() {
    if (!photo) return;
    await toggleFav.mutateAsync({ id: photo.id, data: { favorite: !photo.isFavorite } });
    queryClient.invalidateQueries({ queryKey: ["listPhotos"] });
  }

  async function handleTrash() {
    if (!photo) return;
    Alert.alert("Move to trash?", photo.filename ?? "This photo", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Trash", style: "destructive",
        onPress: async () => {
          await trashPhoto.mutateAsync({ id: photo.id, data: { trashed: true } });
          queryClient.invalidateQueries({ queryKey: ["listPhotos"] });
          if (index >= photos.length - 1) {
            if (index > 0) setIndex(i => i - 1);
            else onClose();
          }
        },
      },
    ]);
  }

  async function handleShare() {
    if (!photo) return;
    try {
      const share = await createShare.mutateAsync({ data: { photoId: photo.id, expiresInHours: 48 } });
      const shareToken = (share as any).token ?? (share as any).id;
      const appUrl = process.env.EXPO_PUBLIC_API_URL?.replace("/api", "") ?? "";
      await Share.share({ message: `${appUrl}/share/${shareToken}` });
    } catch {
      Alert.alert("Share failed");
    }
  }

  if (!photo) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-black">
        {/* Top bar */}
        <View className="flex-row items-center justify-between px-4 py-2">
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={28} color="white" />
          </TouchableOpacity>
          <Text className="text-white text-sm opacity-70">
            {index + 1} / {photos.length}
          </Text>
          <View style={{ width: 28 }} />
        </View>

        {/* Photo */}
        <View className="flex-1 items-center justify-center">
          {urlData?.url ? (
            <Image
              source={{ uri: urlData.url }}
              style={{ width: SCREEN_W, height: SCREEN_H * 0.72 }}
              contentFit="contain"
              cachePolicy="memory-disk"
            />
          ) : (
            <ActivityIndicator color="white" />
          )}
        </View>

        {/* Prev/Next */}
        {index > 0 && (
          <TouchableOpacity
            onPress={goBack}
            className="absolute left-2"
            style={{ top: "50%" }}
            hitSlop={20}
          >
            <Ionicons name="chevron-back" size={36} color="white" />
          </TouchableOpacity>
        )}
        {index < photos.length - 1 && (
          <TouchableOpacity
            onPress={goForward}
            className="absolute right-2"
            style={{ top: "50%" }}
            hitSlop={20}
          >
            <Ionicons name="chevron-forward" size={36} color="white" />
          </TouchableOpacity>
        )}

        {/* Bottom actions */}
        <View className="flex-row items-center justify-around px-6 py-4 border-t border-white/10">
          <TouchableOpacity onPress={handleFavorite} hitSlop={12}>
            <Ionicons
              name={photo.isFavorite ? "heart" : "heart-outline"}
              size={26}
              color={photo.isFavorite ? "#ef4444" : "white"}
            />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} hitSlop={12}>
            <Ionicons name="share-outline" size={26} color="white" />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleTrash} hitSlop={12}>
            <Ionicons name="trash-outline" size={26} color="white" />
          </TouchableOpacity>
        </View>

        {/* Filename */}
        {photo.filename && (
          <Text className="text-white/50 text-xs text-center pb-2">{photo.filename}</Text>
        )}
      </SafeAreaView>
    </Modal>
  );
}
