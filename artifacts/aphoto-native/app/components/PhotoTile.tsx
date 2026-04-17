import { Image } from "expo-image";
import { TouchableOpacity, View, Dimensions } from "react-native";

const SCREEN_WIDTH = Dimensions.get("window").width;
const COLS = 3;
const GAP = 2;
export const TILE_SIZE = (SCREEN_WIDTH - GAP * (COLS + 1)) / COLS;

interface Props {
  photoId: string;
  thumbnailUrl: string | null | undefined;
  isSelected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}

export default function PhotoTile({ photoId, thumbnailUrl, isSelected, onPress, onLongPress }: Props) {
  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      activeOpacity={0.85}
      style={{ width: TILE_SIZE, height: TILE_SIZE, margin: GAP / 2 }}
    >
      <Image
        source={thumbnailUrl ? { uri: thumbnailUrl } : require("../../assets/icon.png")}
        style={{ width: TILE_SIZE, height: TILE_SIZE }}
        contentFit="cover"
        recyclingKey={photoId}
        cachePolicy="memory-disk"
      />
      {isSelected && (
        <View
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: "rgba(59,130,246,0.45)",
            borderWidth: 2,
            borderColor: "#3b82f6",
          }}
        />
      )}
    </TouchableOpacity>
  );
}
