// Audit P10 — Android drops any push whose channel doesn't exist on the
// device. The server's channelId is typed against
// ANDROID_NOTIFICATION_CHANNELS; this proves the app creates every one.
jest.mock("expo-notifications", () => ({
  setNotificationChannelAsync: jest.fn(() => Promise.resolve(null)),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-constants", () => ({ __esModule: true, default: {} }));
jest.mock("@/services/api", () => ({ api: {} }));
jest.mock("@/services/analytics", () => ({ logError: jest.fn() }));
jest.mock("@/services/notification-dedup", () => ({ markNotificationSeen: jest.fn() }));
jest.mock("@/stores/profile.store", () => ({ useProfileStore: { getState: jest.fn() } }));
jest.mock("@/stores/auth.store", () => ({ useAuthStore: { getState: jest.fn() } }));
jest.mock("@/utils/runtime", () => ({ isExpoGo: false }));

import * as Notifications from "expo-notifications";
import { ANDROID_NOTIFICATION_CHANNELS } from "@swasth/shared-types";

import { ensureAndroidChannels } from "@/services/notifications";

describe("ensureAndroidChannels", () => {
  it("creates every channel the server may push to", async () => {
    await ensureAndroidChannels();
    const created = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls.map(
      (call: unknown[]) => call[0],
    );
    expect(created).toEqual(Object.keys(ANDROID_NOTIFICATION_CHANNELS));
    // The channels the audit found missing.
    expect(created).toEqual(expect.arrayContaining(["reminders", "medications", "guardian"]));
  });

  it("keeps critical alerts at max importance, able to bypass Do Not Disturb", async () => {
    await ensureAndroidChannels();
    const critical = (Notifications.setNotificationChannelAsync as jest.Mock).mock.calls.find(
      (call: unknown[]) => call[0] === "critical",
    ) as [string, { importance: number; bypassDnd?: boolean }];
    expect(critical[1].importance).toBe(5);
    expect(critical[1].bypassDnd).toBe(true);
  });
});
