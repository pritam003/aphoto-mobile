import { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { loginWithMicrosoft, loginWithGoogle } from "../lib/auth";
import { useAuthContext } from "../context/AuthContext";

export default function LoginScreen() {
  const router = useRouter();
  const { setSession } = useAuthContext();
  const [loadingProvider, setLoadingProvider] = useState<"microsoft" | "google" | null>(null);

  async function handleLogin(provider: "microsoft" | "google") {
    setLoadingProvider(provider);
    try {
      const { token, user } =
        provider === "microsoft"
          ? await loginWithMicrosoft()
          : await loginWithGoogle();
      await setSession(token, user);
      router.replace("/(app)/(tabs)/");
    } catch (err: any) {
      const msg = err?.message ?? "Login failed";
      if (!msg.includes("cancelled")) {
        Alert.alert("Login failed", msg);
      }
    } finally {
      setLoadingProvider(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 items-center justify-center px-8 gap-8">
          {/* Logo / branding */}
          <View className="items-center gap-3">
            <View className="w-20 h-20 bg-primary rounded-2xl items-center justify-center">
              <Text className="text-white text-4xl">📷</Text>
            </View>
            <Text className="text-foreground text-3xl font-bold tracking-tight">
              APhoto
            </Text>
            <Text className="text-muted text-base text-center">
              Your private photo library
            </Text>
          </View>

          {/* Login buttons */}
          <View className="w-full gap-3">
            <TouchableOpacity
              onPress={() => handleLogin("microsoft")}
              disabled={loadingProvider !== null}
              className="w-full bg-surface border border-border rounded-xl py-4 px-6 flex-row items-center justify-center gap-3"
              activeOpacity={0.7}
            >
              {loadingProvider === "microsoft" ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text className="text-[#00a4ef] text-lg">⊞</Text>
              )}
              <Text className="text-foreground text-base font-medium">
                Continue with Microsoft
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => handleLogin("google")}
              disabled={loadingProvider !== null}
              className="w-full bg-surface border border-border rounded-xl py-4 px-6 flex-row items-center justify-center gap-3"
              activeOpacity={0.7}
            >
              {loadingProvider === "google" ? (
                <ActivityIndicator color="#ffffff" size="small" />
              ) : (
                <Text className="text-lg">G</Text>
              )}
              <Text className="text-foreground text-base font-medium">
                Continue with Google
              </Text>
            </TouchableOpacity>
          </View>

          <Text className="text-muted text-xs text-center">
            Sign in with your organization account to access your private photo library.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
