// Phase 4 §F.13 — full-screen camera capture for prescription / medicine
// photos. Single capture per open; the caller appends to its own list and
// re-opens for the next photo. Quality 0.6 keeps the upload small — the
// server re-encodes (sharp) regardless.

import { useRef } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";

interface Props {
  visible: boolean;
  onCapture: (uri: string) => void;
  onClose: () => void;
}

export const CameraCaptureModal = ({ visible, onCapture, onClose }: Props): JSX.Element => {
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const capture = async (): Promise<void> => {
    const cam = cameraRef.current;
    if (!cam) return;
    const photo = await cam.takePictureAsync({ quality: 0.6 });
    if (photo?.uri) onCapture(photo.uri);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView className="flex-1 bg-black">
        {!permission?.granted ? (
          <View className="flex-1 items-center justify-center px-6">
            <Text className="mb-2 text-center text-important font-bold text-white">
              {t("prescriptions.camera.permissionTitle")}
            </Text>
            <Text className="mb-6 text-center text-body text-gray-300">
              {t("prescriptions.camera.permissionBody")}
            </Text>
            <Button
              label={t("prescriptions.camera.grant")}
              onPress={() => void requestPermission()}
              style={{ minWidth: 220 }}
            />
            <Pressable
              onPress={onClose}
              className="mt-4 px-5 py-3"
              accessibilityRole="button"
              style={{ minHeight: 48 }}
            >
              <Text className="text-body text-gray-400">{t("prescriptions.camera.cancel")}</Text>
            </Pressable>
          </View>
        ) : (
          <View className="flex-1">
            <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
            <View className="flex-row items-center justify-between bg-black px-6 py-5">
              <Pressable
                onPress={onClose}
                accessibilityRole="button"
                className="px-4 py-3"
                style={{ minHeight: 48, minWidth: 48 }}
              >
                <Text className="text-important text-gray-300">
                  {t("prescriptions.camera.cancel")}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void capture()}
                accessibilityRole="button"
                accessibilityLabel={t("prescriptions.camera.capture")}
                className="items-center justify-center rounded-full border-4 border-white bg-white/20"
                style={{ width: 76, height: 76 }}
              >
                <View className="rounded-full bg-white" style={{ width: 56, height: 56 }} />
              </Pressable>
              <View style={{ width: 48 }} />
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
};
