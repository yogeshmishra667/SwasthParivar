// Audit P3 — a `critical_alert` push raises the fullscreen alert: the
// patient's own on a device holding the reading's profile, a guardian
// variant anywhere else.
jest.mock("expo-notifications", () => ({
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
let mockHouseholdId: string | null = "h1";
jest.mock("@/stores/profile.store", () => ({
  useProfileStore: {
    getState: () => ({
      householdId: mockHouseholdId,
      profiles: [{ id: "papa" }, { id: "maa" }],
      activeProfileId: "papa",
    }),
  },
}));
jest.mock("@/stores/auth.store", () => ({
  useAuthStore: { getState: () => ({ userId: "papa" }) },
}));
jest.mock("@/utils/runtime", () => ({ isExpoGo: false }));

import { raiseCriticalAlertFromPush } from "@/services/notifications";
import { useCriticalAlertStore } from "@/stores/critical-alert.store";

beforeEach(() => {
  mockHouseholdId = "h1";
  useCriticalAlertStore.setState({
    current: null,
    queue: [],
    lastLocalRaise: {},
    shownReadingIds: [],
  });
});

const current = () => useCriticalAlertStore.getState().current;

describe("raiseCriticalAlertFromPush", () => {
  it("a household profile's glucose alert → the patient's fullscreen alert", () => {
    raiseCriticalAlertFromPush({
      type: "critical_alert",
      targetUserId: "maa",
      readingId: "r1",
      severity: "low",
      valueLabel: "48 mg/dL",
    });
    expect(current()).toEqual({
      id: expect.any(Number),
      audience: "patient",
      userId: "maa",
      category: "glucose",
      direction: "low",
      valueLabel: "48 mg/dL",
    });
  });

  it.each([
    ["bp", "critical.bp.high", { direction: "high" }],
    ["cardiac", "critical.cardiac.chest_pain", { reasonKey: "chest_pain" }],
    ["respiratory", "critical.respiratory.peak_flow", { reasonKey: "peak_flow" }],
  ])("%s → its own copy", (category, copyKey, expected) => {
    raiseCriticalAlertFromPush({ type: "critical_alert", targetUserId: "papa", category, copyKey });
    expect(current()).toMatchObject({ audience: "patient", category, ...expected });
  });

  it("another household's patient → the guardian variant with the push's copy", () => {
    raiseCriticalAlertFromPush(
      { type: "critical_alert", targetUserId: "ramesh-ji", readingId: "r2", severity: "high" },
      { title: "Ramesh ji: Sugar Bahut Zyada", body: "Sugar 340 — call now" },
    );
    expect(current()).toMatchObject({
      audience: "guardian",
      userId: null,
      patientId: "ramesh-ji",
      title: "Ramesh ji: Sugar Bahut Zyada",
      body: "Sugar 340 — call now",
    });
  });

  it("ignores other notification types", () => {
    raiseCriticalAlertFromPush({ type: "guardian_alert", alertId: "a1" });
    raiseCriticalAlertFromPush({ type: "med_reminder", targetUserId: "papa" });
    expect(current()).toBeNull();
  });

  it("before the household is loaded (cold-start tap), a sub-profile's push is the patient's alert (review C1)", () => {
    mockHouseholdId = null;
    raiseCriticalAlertFromPush({ type: "critical_alert", targetUserId: "maa", severity: "low" });
    expect(current()).toMatchObject({ audience: "patient", userId: "maa" });
  });

  it("the logged-in account's own push is always the patient's alert", () => {
    mockHouseholdId = null;
    raiseCriticalAlertFromPush({ type: "critical_alert", targetUserId: "papa", severity: "high" });
    expect(current()).toMatchObject({ audience: "patient", userId: "papa" });
  });

  it("the same push seen by the received and the tap handler shows once, even without a readingId", () => {
    const data = { type: "critical_alert", targetUserId: "ramesh-ji", notificationId: "n1" };
    raiseCriticalAlertFromPush(data);
    useCriticalAlertStore.getState().dismiss();
    raiseCriticalAlertFromPush(data);
    expect(current()).toBeNull();
  });

  it("an unknown category shows the push's own copy, not glucose's (review W5)", () => {
    raiseCriticalAlertFromPush(
      { type: "critical_alert", targetUserId: "papa", category: "kidney" },
      { title: "Papa: alert", body: "Call now" },
    );
    expect(current()).toMatchObject({
      audience: "patient",
      title: "Papa: alert",
      body: "Call now",
    });
  });
});
