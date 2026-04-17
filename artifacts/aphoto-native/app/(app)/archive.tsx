import { useState, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
  TextInput,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useListPhotos, getListPhotosQueryKey } from "@workspace/api-client-react";
import { useAuthContext } from "../context/AuthContext";
import PhotoGrid from "../components/PhotoGrid";
import Lightbox from "../components/Lightbox";
import Constants from "expo-constants";

export default function ArchiveScreen() {
  const { token } = useAuthContext();
  const queryClient = useQueryClient();
  const [unlocked, setUnlocked] = useState(false);
  const [totp, setTotp] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const apiUrl = (Constants.expoConfig?.extra?.apiUrl as string) ?? "";

  const { data, isLoading } = useListPhotos(
    { hidden: true, trashed: false, limit: 500 },
    { query: { enabled: unlocked, staleTime: 60_000 } }
  );

  const photos = data?.photos ?? [];

  const handleUnlock = useCallback(async () => {
    if (!totp.trim() || !token) return;
    setVerifying(true);
    setError("");
    try {
      const res = await fetch(`${apiUrl}/api/archive-lock/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ code: totp.trim() }),
      });
      if (res.ok) {
        setUnlocked(true);
        setTotp("");
      } else {
        const data = await res.json().catch(() => ({})) as { error?: string };
        setError(data.error ?? "Invalid code");
      }
    } catch {
      setError("Network error");
    } finally {
      setVerifying(false);
    }
  }, [totp, token, apiUrl]);

  if (!unlocked) {
    return (
      <SafeAreaView className="flex-1 bg-background items-center justify-center px-8" edges={["bottom"]}>
        <View className="items-center gap-6 w-full">
          <View className="w-16 h-16 bg-surface border border-border rounded-2xl items-center justify-center">
            <Ionicons name="lock-closed" size={32} color="#6b7280" />
          </View>
          <View className="items-center gap-1">
            <Text className="text-foreground text-xl font-bold">Archive Lock</Text>
            <Text className="text-muted text-sm text-center">
              Enter your authenticator code to view hidden photos.
            </Text>
          </View>
          <TextInput
            value={totp}
            onChangeText={setTotp}
            placeholder="6-digit code"
            placeholderTextColor="#6b7280"
            keyboardType="number-pad"
            maxLength={6}
            className="bg-surface text-foreground text-center text-2xl tracking-widest rounded-xl px-6 py-4 border border-border w-full"
            onSubmitEditing={handleUnlock}
          />
          {error ? <Text className="text-destructive text-sm">{error}</Text> : null}
          <TouchableOpacity
            onPress={handleUnlock}
            disabled={totp.length < 6 || verifying}
            className="bg-primary rounded-xl py-3 px-10 items-center"
          >
            {verifying ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text className="text-white font-semibold text-base">Unlock</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <View className="flex-row items-center justify-between px-4 py-3">
        <Text className="text-foreground text-xl font-bold">Archive</Text>
        <TouchableOpacity
          onPress={() => setUnlocked(false)}
          hitSlop={8}
          className="flex-row items-center gap-1"
        >
          <Ionicons name="lock-closed-outline" size={16} color="#6b7280" />
          <Text className="text-muted text-sm">Lock</Text>
        </TouchableOpacity>
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
            emptyMessage="No hidden photos."
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
