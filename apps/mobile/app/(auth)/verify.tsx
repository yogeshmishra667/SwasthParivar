import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
  Keyboard,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { useAuthStore } from "@/stores/auth.store";
import { confirmFirebaseOtp } from "@/services/firebase-auth";
import type { OtpProvider } from "@/services/auth-config";
import { logError } from "@/services/analytics";
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
  const { phone, provider } = useLocalSearchParams<{ phone: string; provider?: string }>();
  // login.tsx passes the provider as a router param so we don't refetch
  // it here. If it's missing (deep-link or stale nav), default to the
  // legacy "log" path — that's the safest fallback because it routes
  // through verify-otp which honours the 000000 dev bypass.
  const otpProvider: OtpProvider =
    provider === "firebase" || provider === "whatsapp" ? provider : "log";
  const setTokens = useAuthStore((s) => s.setTokens);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const submittedRef = useRef(false);

  const verify = async (otpToSend: string = otp): Promise<void> => {
    if (otpToSend.length !== 6) {
      Alert.alert("6 digit OTP dalein");
      return;
    }
    if (submittedRef.current || loading) return;
    submittedRef.current = true;
    setLoading(true);
    Keyboard.dismiss();
    try {
      let envelope: VerifyResponse;

      if (otpProvider === "firebase") {
        // Mobile-side OTP confirmation via @react-native-firebase/auth.
        // The resulting ID token is what the server actually trusts —
        // it carries the verified phone_number claim Firebase signed.
        const idToken = await confirmFirebaseOtp(otpToSend);
        envelope = await api.post<VerifyResponse, { idToken: string }>("/auth/verify-firebase", {
          idToken,
        });
      } else {
        envelope = await api.post<VerifyResponse, { phone: string; otp: string }>(
          "/auth/verify-otp",
          { phone: `+91${phone ?? ""}`, otp: otpToSend },
        );
      }

      await setTokens(envelope.data.accessToken, envelope.data.refreshToken, envelope.data.userId);
      // Let index.tsx resolve the correct destination based on onboardingComplete + step
      router.replace("/");
    } catch (err) {
      submittedRef.current = false;
      logError("verify.submit", err);
      Alert.alert("OTP galat hai");
    } finally {
      setLoading(false);
    }
  };

  // Note: we intentionally do NOT cancel pending Firebase confirmation
  // on unmount. Effect cleanups can fire during dev-mode double-mounts
  // (Strict Mode, fast refresh, route transitions) and would wipe the
  // ConfirmationResult that login.tsx just set — making confirmation
  // impossible. The next startFirebasePhoneAuth call overwrites the
  // singleton anyway, so a stale value is harmless.

  // Auto-submit as soon as the user fills 6 digits (paste, autofill, or
  // the last keypress). The submittedRef guard prevents double-fires.
  useEffect(() => {
    if (otp.length === 6 && !submittedRef.current) {
      void verify(otp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [otp]);

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: "center",
            padding: 24,
            paddingBottom: 48,
          }}
          keyboardShouldPersistTaps="handled"
        >
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
              {t("auth.otpSentSubtitle", {
                defaultValue: `We have sent a 6-digit code to +91 ${phone || ""}`,
              })}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="mb-2 text-important font-semibold text-gray-800">
              {t("auth.enterOtp")}
            </Text>
            <TextInput
              value={otp}
              onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, ""))}
              keyboardType="number-pad"
              maxLength={6}
              placeholder="000000"
              placeholderTextColor="#9CA3AF"
              accessibilityLabel="OTP input"
              autoFocus
              textContentType="oneTimeCode"
              autoComplete="sms-otp"
              importantForAutofill="yes"
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
