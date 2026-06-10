// Phase 4 §F.13 — paired upload screen. One screen, two photo strips:
// the doctor's prescription (1–3, required) and the medicine packets
// (0–5, optional but the only path to a GREEN item). On success we
// replace into the detail screen so OCR results stream in.

import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/Button";
import { CameraCaptureModal } from "@/components/prescriptions/CameraCaptureModal";
import { PhotoStrip } from "@/components/prescriptions/PhotoStrip";
import { uploadPrescription, type CapturedPhoto } from "@/services/prescriptions";
import { logError } from "@/services/analytics";

const toPhoto = (uri: string): CapturedPhoto => ({
  uri,
  name: `photo-${Date.now()}.jpg`,
});

export default function PrescriptionUploadScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();

  const [parchi, setParchi] = useState<string[]>([]);
  const [packets, setPackets] = useState<string[]>([]);
  const [cameraFor, setCameraFor] = useState<"parchi" | "packet" | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCapture = (uri: string): void => {
    if (cameraFor === "parchi") setParchi((p) => [...p, uri]);
    else if (cameraFor === "packet") setPackets((p) => [...p, uri]);
    setCameraFor(null);
  };

  const onSubmit = async (): Promise<void> => {
    if (parchi.length === 0) {
      setError(t("prescriptions.upload.needAtLeastOne"));
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await uploadPrescription({
        prescriptionPhotos: parchi.map(toPhoto),
        medicinePhotos: packets.map(toPhoto),
      });
      router.replace(`/prescriptions/${res.prescriptionId}`);
    } catch (err) {
      logError("prescription-upload", err);
      setError(t("prescriptions.upload.failed"));
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-gray-50 dark:bg-gray-950">
      <Stack.Screen options={{ headerShown: true, title: t("prescriptions.upload.title") }} />
      <ScrollView className="flex-1 px-4 pt-4" keyboardShouldPersistTaps="handled">
        <PhotoStrip
          label={t("prescriptions.upload.parchiLabel")}
          hint={t("prescriptions.upload.parchiHint")}
          uris={parchi}
          max={3}
          onAdd={() => setCameraFor("parchi")}
          onRemove={(i) => setParchi((p) => p.filter((_, idx) => idx !== i))}
          onClear={() => setParchi([])}
        />
        <PhotoStrip
          label={t("prescriptions.upload.packetLabel")}
          hint={t("prescriptions.upload.packetHint")}
          uris={packets}
          max={5}
          onAdd={() => setCameraFor("packet")}
          onRemove={(i) => setPackets((p) => p.filter((_, idx) => idx !== i))}
          onClear={() => setPackets([])}
        />

        {error ? <Text className="mb-3 text-body text-critical">{error}</Text> : null}
      </ScrollView>

      <View className="border-t border-gray-200 px-4 py-4 dark:border-gray-800">
        <Button
          label={submitting ? t("prescriptions.upload.uploading") : t("prescriptions.upload.cta")}
          onPress={() => void onSubmit()}
          disabled={submitting || parchi.length === 0}
          style={submitting || parchi.length === 0 ? { opacity: 0.5 } : undefined}
          accessibilityState={{ disabled: submitting || parchi.length === 0 }}
        />
      </View>

      <CameraCaptureModal
        visible={cameraFor !== null}
        onCapture={onCapture}
        onClose={() => setCameraFor(null)}
      />
    </SafeAreaView>
  );
}
