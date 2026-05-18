import { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/services/api";
import { fetchOtpProvider } from "@/services/auth-config";
import { startFirebasePhoneAuth } from "@/services/firebase-auth";
import { logError } from "@/services/analytics";
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
      // Provider check first — the rest of the flow forks here.
      // - firebase: skip our /send-otp, mobile SDK delivers the SMS.
      // - whatsapp / log: hit /send-otp as before.
      const provider = await fetchOtpProvider();
      const phoneE164 = `+91${phone}`;

      if (provider === "firebase") {
        await startFirebasePhoneAuth(phoneE164);
      } else {
        await api.post("/auth/send-otp", { phone: phoneE164 });
      }

      router.push({ pathname: "/(auth)/verify", params: { phone, provider } });
    } catch (err) {
      logError("login.sendOtp", err);
      Alert.alert("Dikkat hui", "Kripya thodi der baad try karein.");
    } finally {
      setLoading(false);
    }
  };

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
          <View className="mb-10 items-center">
            <View className="mb-4 h-24 w-24 items-center justify-center rounded-full bg-blue-50">
              <Icon name="medkit" size={48} color="#2563EB" />
            </View>
            <Text className="text-3xl font-bold text-gray-900 tracking-tight">SwasthParivar</Text>
            <Text className="mt-2 text-center text-body text-gray-500">
              {t("auth.subtitle", {
                defaultValue: "Apni family ki health ka dhyan rakhein, asani se.",
              })}
            </Text>
          </View>

          <View className="mb-6">
            <Text className="mb-2 text-important font-semibold text-gray-800">
              {t("auth.enterPhone")}
            </Text>
            <View
              style={{ minHeight: TOUCH_TARGET_MIN }}
              className="flex-row items-center overflow-hidden rounded-2xl border border-gray-300 bg-gray-50"
            >
              <View className="flex-row items-center border-r border-gray-300 px-4 py-4 bg-gray-100">
                <Text className="text-important font-bold text-gray-700">+91</Text>
              </View>
              <TextInput
                value={phone}
                onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, ""))}
                keyboardType="phone-pad"
                maxLength={10}
                placeholder="00000 00000"
                placeholderTextColor="#9CA3AF"
                accessibilityLabel="Phone number input"
                className="flex-1 px-4 py-4 text-important font-semibold text-gray-900"
              />
            </View>
          </View>

          <Button
            label={t("auth.sendOtp")}
            onPress={() => void sendOtp()}
            disabled={loading || phone.length < 10}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
