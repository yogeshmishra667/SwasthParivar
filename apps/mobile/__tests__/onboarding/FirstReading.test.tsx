// Audit P3 — a critical first reading (onboarding) raises the fullscreen
// alert instead of the trophy celebration.
const mockSave = jest.fn();
jest.mock("@/services/readings", () => ({
  saveGlucoseReading: (...args: unknown[]): unknown => mockSave(...args),
}));
jest.mock("@/services/api", () => ({ api: { patch: jest.fn(() => Promise.resolve({})) } }));
jest.mock("@/services/analytics", () => ({ logError: jest.fn(), track: jest.fn() }));
jest.mock("@/stores/auth.store", () => ({
  useAuthStore: (sel: (s: { userId: string }) => unknown): unknown => sel({ userId: "papa" }),
}));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => {
  const RN = jest.requireActual<typeof ReactNative>("react-native");
  return { SafeAreaView: RN.View };
});
jest.mock("@/utils/haptics", () => ({ hapticCelebrate: jest.fn() }));
// Stand-ins: enter a value, then confirm it.
jest.mock("@/components/logging/NumpadInput", () => {
  const { Pressable, Text } = jest.requireActual<typeof ReactNative>("react-native");
  return {
    NumpadInput: ({ onSubmit }: { onSubmit: (v: number) => void }) => (
      <Pressable onPress={() => onSubmit(globalThis.__firstValue)}>
        <Text>enter</Text>
      </Pressable>
    ),
  };
});
jest.mock("@/components/logging/ConfirmationScreen", () => {
  const { Pressable, Text } = jest.requireActual<typeof ReactNative>("react-native");
  return {
    ConfirmationScreen: ({ onConfirm }: { onConfirm: (t: string, c: string) => void }) => (
      <Pressable onPress={() => onConfirm("fasting", "normal")}>
        <Text>confirm</Text>
      </Pressable>
    ),
  };
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type * as ReactNative from "react-native";

import FirstReadingScreen from "@/../app/(onboarding)/first-reading";
import { useCriticalAlertStore } from "@/stores/critical-alert.store";
import { hapticCelebrate } from "@/utils/haptics";

declare global {
  var __firstValue: number;
}

const enter = (value: number): void => {
  globalThis.__firstValue = value;
  render(<FirstReadingScreen />);
  fireEvent.press(screen.getByText("enter"));
  fireEvent.press(screen.getByText("confirm"));
};

beforeEach(() => {
  useCriticalAlertStore.setState({
    current: null,
    queue: [],
    lastLocalRaise: {},
    shownReadingIds: [],
  });
  mockSave.mockReset();
  (hapticCelebrate as jest.Mock).mockClear();
});

describe("onboarding first reading", () => {
  it("a critical first reading raises the fullscreen alert, with no trophy", async () => {
    mockSave.mockResolvedValue({
      kind: "synced",
      critical: { isCritical: true, direction: "low" },
    });
    enter(45);
    await waitFor(() =>
      expect(screen.getByText("onboarding.firstReadingCriticalTitle")).toBeTruthy(),
    );
    expect(useCriticalAlertStore.getState().current).toMatchObject({
      userId: "papa",
      category: "glucose",
      direction: "low",
      valueLabel: "45 mg/dL",
    });
    expect(screen.queryByText("onboarding.celebrate")).toBeNull();
    expect(hapticCelebrate).not.toHaveBeenCalled();
  });

  it("offline, a critical first reading still raises the alert", async () => {
    mockSave.mockResolvedValue({ kind: "queued", clientUuid: "u1" });
    enter(340);
    await waitFor(() =>
      expect(useCriticalAlertStore.getState().current).toMatchObject({ direction: "high" }),
    );
  });

  it("a normal first reading is celebrated", async () => {
    mockSave.mockResolvedValue({ kind: "synced", critical: { isCritical: false } });
    enter(118);
    await waitFor(() => expect(screen.getByText("onboarding.celebrate")).toBeTruthy());
    expect(useCriticalAlertStore.getState().current).toBeNull();
    expect(hapticCelebrate).toHaveBeenCalled();
  });
});
