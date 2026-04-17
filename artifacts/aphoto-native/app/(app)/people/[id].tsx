import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  TextInput,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import { useAuthContext } from "../../context/AuthContext";
import PhotoGrid from "../../components/PhotoGrid";
import Lightbox from "../../components/Lightbox";

interface PersonDetail {
  id: string;
  name: string | null;
  photos: any[];
}

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { token } = useAuthContext();
  const [person, setPerson] = useState<PersonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const apiUrl = (Constants.expoConfig?.extra?.apiUrl as string) ?? "";

  useEffect(() => {
    if (!token || !id) return;
    (async () => {
      const res = await fetch(`${apiUrl}/api/people/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json() as PersonDetail;
        setPerson(data);
      }
      setLoading(false);
    })();
  }, [id, token, apiUrl]);

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <ScrollView className="flex-1">
        <PhotoGrid
          photos={person?.photos ?? []}
          onPhotoPress={(_, index) => setLightboxIndex(index)}
          emptyMessage="No photos found for this person."
        />
      </ScrollView>

      {lightboxIndex !== null && (
        <Lightbox
          photos={person?.photos ?? []}
          initialIndex={lightboxIndex}
          visible
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </SafeAreaView>
  );
}
