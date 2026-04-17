import { useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  Alert,
} from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import Constants from "expo-constants";

interface Person {
  id: string;
  name: string | null;
  coverUrl: string | null;
  faceCount: number;
}

interface ScanProgress {
  total: number;
  processed: number;
  status: "idle" | "scanning" | "done";
}

async function fetchPeople(token: string, apiUrl: string): Promise<Person[]> {
  const res = await fetch(`${apiUrl}/api/people`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const data = await res.json() as { people: Person[] };
  return data.people ?? [];
}

import { useAuthContext } from "../../context/AuthContext";

export default function PeopleScreen() {
  const router = useRouter();
  const { token } = useAuthContext();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const apiUrl = (Constants.expoConfig?.extra?.apiUrl as string) ?? "";

  useState(() => {
    if (!token) return;
    fetchPeople(token, apiUrl).then(p => {
      setPeople(p);
      setLoading(false);
    });
  });

  const filtered = search
    ? people.filter(p => p.name?.toLowerCase().includes(search.toLowerCase()))
    : people;

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="px-4 py-3 gap-2">
        <Text className="text-foreground text-xl font-bold">People</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by name…"
          placeholderTextColor="#6b7280"
          className="bg-surface text-foreground rounded-xl px-4 py-2 border border-border text-sm"
        />
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#3b82f6" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(p) => p.id}
          numColumns={3}
          contentContainerStyle={{ padding: 8 }}
          columnWrapperStyle={{ gap: 8, marginBottom: 8 }}
          ListEmptyComponent={
            <View className="items-center justify-center py-20">
              <Text className="text-muted text-center">
                No people found. Face recognition runs automatically when photos are uploaded.
              </Text>
            </View>
          }
          renderItem={({ item: person }) => (
            <TouchableOpacity
              onPress={() => router.push(`/(app)/people/${person.id}`)}
              className="flex-1 items-center gap-1"
            >
              {person.coverUrl ? (
                <Image
                  source={{ uri: person.coverUrl }}
                  style={{ width: 80, height: 80, borderRadius: 40 }}
                  contentFit="cover"
                />
              ) : (
                <View
                  className="bg-surface items-center justify-center rounded-full border border-border"
                  style={{ width: 80, height: 80 }}
                >
                  <Ionicons name="person" size={36} color="#6b7280" />
                </View>
              )}
              <Text className="text-foreground text-xs text-center" numberOfLines={1}>
                {person.name ?? "Unknown"}
              </Text>
              <Text className="text-muted text-xs">{person.faceCount}</Text>
            </TouchableOpacity>
          )}
        />
      )}
    </SafeAreaView>
  );
}
