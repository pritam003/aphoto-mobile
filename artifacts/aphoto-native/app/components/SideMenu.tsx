import { View, Text, TouchableOpacity, Modal } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useAuthContext } from "../context/AuthContext";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function SideMenu({ visible, onClose }: Props) {
  const router = useRouter();
  const { user, logout } = useAuthContext();

  function navigate(path: string) {
    onClose();
    router.push(path as any);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 flex-row">
        {/* Backdrop */}
        <TouchableOpacity className="flex-1" onPress={onClose} activeOpacity={1} />

        {/* Drawer */}
        <View className="w-72 bg-surface h-full py-12 px-6 gap-1">
          <View className="px-2 py-4 mb-2">
            <Text className="text-foreground font-semibold text-base" numberOfLines={1}>
              {user?.name ?? ""}
            </Text>
            <Text className="text-muted text-sm" numberOfLines={1}>{user?.email ?? ""}</Text>
          </View>

          {[
            { icon: "images-outline", label: "Library", path: "/(app)/(tabs)/" },
            { icon: "heart-outline", label: "Favorites", path: "/(app)/(tabs)/favorites" },
            { icon: "albums-outline", label: "Albums", path: "/(app)/(tabs)/albums" },
            { icon: "people-outline", label: "People", path: "/(app)/(tabs)/people" },
            { icon: "archive-outline", label: "Archive", path: "/(app)/archive" },
            { icon: "trash-outline", label: "Trash", path: "/(app)/trash" },
          ].map(item => (
            <TouchableOpacity
              key={item.path}
              onPress={() => navigate(item.path)}
              className="flex-row items-center gap-3 px-3 py-3 rounded-xl"
              activeOpacity={0.7}
            >
              <Ionicons name={item.icon as any} size={20} color="#9ca3af" />
              <Text className="text-foreground text-base">{item.label}</Text>
            </TouchableOpacity>
          ))}

          <View className="flex-1" />

          <TouchableOpacity
            onPress={async () => { onClose(); await logout(); }}
            className="flex-row items-center gap-3 px-3 py-3 rounded-xl"
          >
            <Ionicons name="log-out-outline" size={20} color="#ef4444" />
            <Text className="text-destructive text-base">Sign out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
