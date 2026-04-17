import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, TouchableOpacity, ActivityIndicator, Share, Dimensions } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useGetSharedPhoto } from "@workspace/api-client-react";

const { width: W } = Dimensions.get("window");

export default function SharedPhotoScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const router = useRouter();

  const { data, isLoading, error } = useGetSharedPhoto(token ?? "", {
    query: { enabled: !!token, retry: false },
  });

  if (isLoading) {
    return (
      <View className="flex-1 bg-black items-center justify-center">
        <ActivityIndicator color="white" />
      </View>
    );
  }

  if (error || !data?.photo) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8 gap-4">
        <Ionicons name="alert-circle-outline" size={48} color="#ef4444" />
        <Text className="text-foreground text-lg font-semibold">Link expired or invalid</Text>
        <TouchableOpacity onPress={() => router.replace("/")} className="bg-primary rounded-xl px-6 py-3">
          <Text className="text-white font-medium">Go to Library</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const photo = data.photo;

  return (
    <SafeAreaView className="flex-1 bg-black">
      <View className="flex-row items-center px-4 py-2">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12}>
          <Ionicons name="close" size={26} color="white" />
        </TouchableOpacity>
      </View>

      <View className="flex-1 items-center justify-center">
        <Image
          source={{ uri: photo.url }}
          style={{ width: W, height: W }}
          contentFit="contain"
          cachePolicy="memory-disk"
        />
      </View>

      <View className="px-4 pb-4 gap-1">
        {photo.filename && (
          <Text className="text-white font-medium">{photo.filename}</Text>
        )}
        {data.expiresAt && (
          <Text className="text-white/50 text-xs">
            Expires {new Date(data.expiresAt).toLocaleDateString()}
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
}
