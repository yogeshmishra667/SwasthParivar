import { useState } from "react";
import { View, Text, TextInput, Alert } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { TOUCH_TARGET_MIN } from "@/utils/constants";

interface VerifyResponse {
  success: boolean;
  data: {
    accessToken: string;
    refreshToken: string;
    userId: string;
    isNew: boolean;
  };
}

export default function VerifyScreen(): JSX.Element {
  const { t } = useTranslation();
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();
  const setTokens = useAuthStore((s) => s.setTokens);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);

  const verify = async (): Promise<void> => {
    if (otp.length !== 6) {
      Alert.alert("6 digit OTP dalein");
      return;
    }
    setLoading(true);
    try {
      const res = await api.post<VerifyResponse, { phone: string; otp: string }>(
        "/auth/verify-otp",
        { phone: `+91${phone ?? ""}`, otp },
      );
      await setTokens(res.data.accessToken, res.data.refreshToken, res.data.userId);
      // Let index.tsx resolve the correct destination based on onboardingComplete + step
      router.replace("/");
    } catch {
      Alert.alert("OTP galat hai");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View className="flex-1 justify-center gap-6 bg-white p-6">
      <Text className="text-important">{t("auth.enterOtp")}</Text>
      <TextInput
        value={otp}
        onChangeText={setOtp}
        keyboardType="number-pad"
        maxLength={6}
        placeholder="6 digit"
        accessibilityLabel="OTP input"
        style={{ minHeight: TOUCH_TARGET_MIN }}
        className="rounded-2xl border border-neutral px-4 text-hero"
      />
      <Button label={t("auth.verify")} onPress={() => void verify()} disabled={loading} />
    </View>
  );
}
