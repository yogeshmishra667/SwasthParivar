// Audit P2 review C1 — the critical alert must never show (or auto-dial)
// another profile's emergency contact, e.g. right after a profile switch
// while the refresh for the new profile is still hanging.
const mockReadCached = jest.fn();
const mockRefresh = jest.fn();
jest.mock("@/services/priority-contact", () => ({
  readCachedPriorityContact: (userId: string): unknown => mockReadCached(userId),
  refreshPriorityContact: (userId: string): unknown => mockRefresh(userId),
}));
jest.mock("@/services/analytics", () => ({ track: jest.fn() }));

import { act, renderHook, waitFor } from "@testing-library/react-native";

import { usePriorityContact } from "@/hooks/usePriorityContact";
import { track } from "@/services/analytics";

const MAA_CONTACT = { id: "maa-c", name: "Beta", phone: "+919800000001" };

beforeEach(() => {
  mockReadCached.mockReset();
  mockRefresh.mockReset();
  (track as jest.Mock).mockClear();
});

describe("usePriorityContact", () => {
  it("never returns the previous profile's contact after a switch while the refresh hangs", async () => {
    mockReadCached.mockImplementation((id: string) =>
      Promise.resolve(id === "maa" ? MAA_CONTACT : null),
    );
    mockRefresh.mockImplementation((id: string) =>
      id === "maa" ? Promise.resolve(MAA_CONTACT) : new Promise(() => undefined),
    );
    const { result, rerender } = renderHook(
      ({ userId }: { userId: string }) => usePriorityContact(userId, true),
      { initialProps: { userId: "maa" } },
    );
    await waitFor(() => expect(result.current).toEqual(MAA_CONTACT));

    rerender({ userId: "papa" });
    expect(result.current).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current).toBeNull();
  });

  it("reports when the profile has no emergency contact", async () => {
    mockReadCached.mockResolvedValue(null);
    mockRefresh.mockResolvedValue(null);
    renderHook(() => usePriorityContact("solo", true));
    await waitFor(() => expect(track).toHaveBeenCalledWith("critical_alert_no_contact"));
  });

  it("looks nothing up while the alert is hidden", () => {
    renderHook(() => usePriorityContact("maa", false));
    expect(mockReadCached).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
