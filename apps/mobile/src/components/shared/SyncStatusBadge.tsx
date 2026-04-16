import { View, Text } from "react-native";

interface Props {
  synced: boolean;
}

export const SyncStatusBadge = ({ synced }: Props): JSX.Element => (
  <View className={`rounded-full px-2 py-0.5 ${synced ? "bg-success/20" : "bg-gray-200"}`}>
    <Text className="text-body">{synced ? "☁️ Synced" : "💾 Saved locally"}</Text>
  </View>
);
