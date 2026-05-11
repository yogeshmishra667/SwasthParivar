import { useState } from "react";
import { View, Text, TextInput, Alert, KeyboardAvoidingView, Platform, ScrollView, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
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
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined} 
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "center", padding: 24 }}>
          
          <Pressable 
            onPress={() => router.back()} 
            className="absolute left-6 top-6 z-10"
            style={{ minHeight: TOUCH_TARGET_MIN, minWidth: TOUCH_TARGET_MIN }}
            accessibilityLabel="Back"
          >
            <Icon name="arrow-back" size={28} color="#374151" />
          </Pressable>

          <View className="mb-10 items-center">
            <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-blue-50">
              <Icon name="chatbubble-ellipses" size={48} color="#2563EB" />
            </View>
            <Text className="text-3xl font-bold tracking-tight text-gray-900">
              {t("auth.otpSentTitle", { defaultValue: "OTP Sent" })}
            </Text>
            <Text className="mt-2 text-center text-body text-gray-500">
              {t("auth.otpSentSubtitle", { defaultValue: `We have sent a 6-digit code to +91 ${phone || ""}` })}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="mb-2 text-important font-semibold text-gray-800">{t("auth.enterOtp")}</Text>
            <TextInput
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor="#9CA3AF"
              accessibilityLabel="OTP input"
              style={{ minHeight: TOUCH_TARGET_MIN, letterSpacing: 8 }}
              className="rounded-2xl border border-gray-300 bg-gray-50 px-4 py-4 text-center text-2xl font-bold tracking-widest text-gray-900"
            />
          </View>

          <Button 
            label={t("auth.verify")} 
            onPress={() => void verify()} 
            disabled={loading || otp.length < 6} 
          />

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
