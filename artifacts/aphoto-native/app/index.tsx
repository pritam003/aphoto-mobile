import { Redirect } from "expo-router";
import { useAuthContext } from "./context/AuthContext";
import { View, ActivityIndicator } from "react-native";

export default function Index() {
  const { isAuthenticated, isLoading } = useAuthContext();

  if (isLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator color="#3b82f6" />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? "/(app)/(tabs)/" : "/(auth)/login"} />;
}
