// Audit P11 — a tapped reminder push is reported, so the server resets
// fatigue and never counts it as ignored.
const mockPost = jest.fn();
const mockTapListeners: ((response: unknown) => void)[] = [];
jest.mock("expo-notifications", () => ({
  setNotificationHandler: jest.fn(),
  AndroidImportance: { DEFAULT: 3, HIGH: 4, MAX: 5 },
  getLastNotificationResponseAsync: jest.fn(() => Promise.resolve(null)),
  addNotificationResponseReceivedListener: jest.fn((cb: (response: unknown) => void) => {
    mockTapListeners.push(cb);
    return { remove: jest.fn() };
  }),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock("react-native", () => ({ Platform: { OS: "android" } }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
jest.mock("expo-device", () => ({ isDevice: true }));
jest.mock("expo-constants", () => ({ __esModule: true, default: {} }));
jest.mock("@/services/api", () => ({
  api: { post: (...args: unknown[]): unknown => mockPost(...args) },
}));
jest.mock("@/services/analytics", () => ({ logError: jest.fn() }));
jest.mock("@/services/notification-dedup", () => ({ markNotificationSeen: jest.fn() }));
jest.mock("@/stores/profile.store", () => ({
  useProfileStore: { getState: () => ({ activeProfileId: "papa", profiles: [] }) },
}));
jest.mock("@/utils/runtime", () => ({ isExpoGo: false }));
jest.mock("@/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ userId: "papa" }) },
}));

import { logError } from "@/services/analytics";
import { registerNotificationRouting, reportNotificationOpened } from "@/services/notifications";

beforeEach(() => {
  mockPost.mockReset().mockResolvedValue({});
  (logError as jest.Mock).mockClear();
});

describe("reportNotificationOpened", () => {
  it.each(["best_time", "missed_day", "re_engagement", "streak_risk", "generic_morning"])(
    "reports a tapped %s push, for its profile",
    (type) => {
      reportNotificationOpened({ type, notificationId: "n-1", targetUserId: "maa" });
      expect(mockPost).toHaveBeenCalledWith("/notifications/opened", {
        notificationId: "n-1",
        targetUserId: "maa",
      });
    },
  );

  it.each(["med_reminder", "critical_alert", "guardian_alert", "guardian_daily_summary"])(
    "does not report a %s push (not a habit reminder)",
    (type) => {
      reportNotificationOpened({ type, notificationId: "n-2", targetUserId: "papa" });
      expect(mockPost).not.toHaveBeenCalled();
    },
  );

  it("needs the push's id", () => {
    reportNotificationOpened({ type: "missed_day" });
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("a failed report is logged, never thrown", async () => {
    mockPost.mockRejectedValueOnce(new Error("offline"));
    reportNotificationOpened({ type: "missed_day", notificationId: "n-3" });
    await Promise.resolve();
    await Promise.resolve();
    expect(logError).toHaveBeenCalledWith("notifications.opened", expect.any(Error));
  });

  it("a tapped reminder is reported through the app's tap handler", () => {
    registerNotificationRouting();
    mockTapListeners[0]!({
      notification: {
        request: { content: { data: { type: "missed_day", notificationId: "n-9" } } },
      },
    });
    expect(mockPost).toHaveBeenCalledWith("/notifications/opened", { notificationId: "n-9" });
  });
});
