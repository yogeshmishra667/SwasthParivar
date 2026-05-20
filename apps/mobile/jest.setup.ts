// Global setup for the mobile Jest harness.

// react-i18next: components render `t("some.key")`. Return the key
// verbatim so assertions match stable identifiers, not translated copy.
jest.mock("react-i18next", () => ({
  useTranslation: (): { t: (key: string) => string } => ({ t: (key) => key }),
}));

// @expo/vector-icons loads fonts asynchronously, firing state updates
// after a test finishes. Stub it to a host component.
jest.mock("@expo/vector-icons", () => ({
  Ionicons: "Ionicons",
}));

// expo-speech-recognition has no native module under Jest — VoiceButton
// lazy-loads VoiceButtonNative which imports it. Stub the surface used.
jest.mock("expo-speech-recognition", () => ({
  ExpoSpeechRecognitionModule: {
    start: jest.fn(),
    stop: jest.fn(),
    requestPermissionsAsync: jest.fn().mockResolvedValue({ granted: false }),
  },
  useSpeechRecognitionEvent: jest.fn(),
}));

// expo-haptics — no native module under Jest. SendButton fires a haptic.
jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(),
  notificationAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: "light", Heavy: "heavy" },
  NotificationFeedbackType: { Success: "success", Warning: "warning", Error: "error" },
}));
