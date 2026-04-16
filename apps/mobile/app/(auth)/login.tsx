import { useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

export default function LoginScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);

  const sendOtp = async (): Promise<void> => {
    if (phone.length !== 10) {
      Alert.alert("Galat number", "10 digit ka phone number dalein.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/send-otp", { phone: `+91${phone}` });
      router.push({ pathname: "/(auth)/verify", params: { phone } });
    } catch {
      Alert.alert("Dikkat hui", "Kripya thodi der baad try karein.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 justify-center gap-6 bg-white p-6">
      <Text className="text-hero font-bold">SwasthParivar</Text>
      <Text className="text-important">{t("auth.enterPhone")}</Text>
      <TextInput
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={10}
        placeholder="10 digit mobile"
        accessibilityLabel="Phone number input"
        style={{ minHeight: TOUCH_TARGET_MIN }}
        className="rounded-2xl border border-neutral px-4 text-important"
      />
      <Button label={t("auth.sendOtp")} onPress={() => void sendOtp()} disabled={loading} />
    </View>
  );
}
