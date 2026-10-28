// Audit P8 UX review — a failed save used to set an error that the confirm
// screen never showed (only a "saved" haptic), and a second tap during a
// slow save made a duplicate. A critical log stored offline gets a call
// button on the saved screen: the family alert waits for sync.
const mockReadCached = jest.fn<Promise<unknown>, [string]>();
jest.mock("@/services/priority-contact", () => ({
  readCachedPriorityContact: (userId: string): Promise<unknown> => mockReadCached(userId),
}));
jest.mock("@/services/analytics", () => ({ track: jest.fn(), logError: jest.fn() }));
jest.mock("react-native-safe-area-context", () => {
  const RN = jest.requireActual<typeof ReactNative>("react-native");
  return { SafeAreaView: RN.View };
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type * as ReactNative from "react-native";
import { Linking } from "react-native";

import { BPConfirmationScreen } from "@/components/logging/BPConfirmationScreen";
import { OfflineCriticalCallButton } from "@/components/logging/OfflineCriticalCallButton";

// The i18n mock (jest.setup.ts) returns keys verbatim.
let openURL: jest.SpyInstance;

beforeEach(() => {
  mockReadCached.mockReset();
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

afterEach(() => {
  openURL.mockRestore();
});

describe("confirm screen save states", () => {
  const props = { systolic: 128, diastolic: 82, onEdit: jest.fn() };

  it("shows why the last save didn't go through, announced to screen readers", () => {
    render(
      <BPConfirmationScreen {...props} onConfirm={jest.fn()} errorMessage="Save nahi ho paya" />,
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByText("Save nahi ho paya")).toBeTruthy();
  });

  it("shows no error box before a failed save", () => {
    render(<BPConfirmationScreen {...props} onConfirm={jest.fn()} />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("can't be confirmed twice or edited while a save is running", () => {
    // An edit mid-save would let the first save's result overwrite the new
    // (possibly critical) value, with no alert for it (safety review W1).
    const onConfirm = jest.fn();
    const onEdit = jest.fn();
    render(<BPConfirmationScreen {...props} onEdit={onEdit} onConfirm={onConfirm} saving />);
    fireEvent.press(screen.getByText("common.loading"));
    fireEvent.press(screen.getByText("common.edit"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("shows the call action under the message when a critical entry failed", () => {
    const { Text } = jest.requireActual<typeof ReactNative>("react-native");
    render(
      <BPConfirmationScreen
        {...props}
        onConfirm={jest.fn()}
        errorMessage="logging.saveFailedCritical"
        errorAction={<Text>call-action</Text>}
      />,
    );
    expect(screen.getByText("call-action")).toBeTruthy();
  });

  it("shows no call action without a failed save", () => {
    const { Text } = jest.requireActual<typeof ReactNative>("react-native");
    render(
      <BPConfirmationScreen
        {...props}
        onConfirm={jest.fn()}
        errorAction={<Text>call-action</Text>}
      />,
    );
    expect(screen.queryByText("call-action")).toBeNull();
  });

  it("confirms with one tap otherwise", () => {
    const onConfirm = jest.fn();
    render(<BPConfirmationScreen {...props} onConfirm={onConfirm} />);
    fireEvent.press(screen.getByText("common.confirm"));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe("OfflineCriticalCallButton", () => {
  it("dials the profile's cached priority-1 contact, and offers 112 too", async () => {
    mockReadCached.mockResolvedValue({ id: "c1", name: "Beta", phone: "+91 98000-00000" });
    render(<OfflineCriticalCallButton userId="papa" />);
    // Nothing until the cache is read: no button changes under the finger.
    expect(screen.queryByText("critical.callEmergency")).toBeNull();
    await waitFor(() => expect(screen.getByText("critical.callContact")).toBeTruthy());
    fireEvent.press(screen.getByText("critical.callContact"));
    expect(mockReadCached).toHaveBeenCalledWith("papa");
    expect(openURL).toHaveBeenCalledWith("tel:+919800000000");
    fireEvent.press(screen.getByText("critical.callEmergency"));
    expect(openURL).toHaveBeenLastCalledWith("tel:112");
  });

  it("falls back to 112 when the profile has no contact", async () => {
    mockReadCached.mockResolvedValue(null);
    render(<OfflineCriticalCallButton userId="papa" />);
    await waitFor(() => expect(screen.getByText("critical.callEmergency")).toBeTruthy());
    expect(screen.queryByText("critical.callContact")).toBeNull();
    fireEvent.press(screen.getByText("critical.callEmergency"));
    expect(openURL).toHaveBeenCalledWith("tel:112");
  });
});
