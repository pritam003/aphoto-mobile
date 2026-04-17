import { Stack, Redirect } from "expo-router";
import { useAuthContext } from "../context/AuthContext";
import { View, ActivityIndicator } from "react-native";

export default function AppLayout() {
  const { isAuthenticated, isLoading } = useAuthContext();

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="albums/[id]" options={{ headerShown: true, title: "Album", headerStyle: { backgroundColor: "#0f0f0f" }, headerTintColor: "#f9fafb" }} />
      <Stack.Screen name="people/[id]" options={{ headerShown: true, title: "Person", headerStyle: { backgroundColor: "#0f0f0f" }, headerTintColor: "#f9fafb" }} />
      <Stack.Screen name="photo/[id]" options={{ presentation: "fullScreenModal", headerShown: false }} />
      <Stack.Screen name="trash" options={{ headerShown: true, title: "Trash", headerStyle: { backgroundColor: "#0f0f0f" }, headerTintColor: "#f9fafb" }} />
      <Stack.Screen name="archive" options={{ headerShown: true, title: "Archive", headerStyle: { backgroundColor: "#0f0f0f" }, headerTintColor: "#f9fafb" }} />
    </Stack>
  );
}
