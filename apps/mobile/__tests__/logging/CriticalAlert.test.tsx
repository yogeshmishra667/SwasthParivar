const mockUsePriorityContact = jest.fn<unknown, [string | null, boolean]>();
jest.mock("@/hooks/usePriorityContact", () => ({
  usePriorityContact: (userId: string | null, active: boolean): unknown =>
    mockUsePriorityContact(userId, active),
}));
jest.mock("@/services/analytics", () => ({ track: jest.fn(), logError: jest.fn() }));

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Linking } from "react-native";

import { CriticalAlert } from "@/components/logging/CriticalAlert";
import { logError, track } from "@/services/analytics";

// The i18n mock (jest.setup.ts) returns keys verbatim.
const base = {
  visible: true,
  userId: "profile-1",
  onDismiss: jest.fn(),
};

const BETA = { id: "contact-1", name: "Beta", phone: "+91 98000-00000" };

let openURL: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers();
  mockUsePriorityContact.mockReset().mockReturnValue(BETA);
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  (track as jest.Mock).mockClear();
});

afterEach(() => {
  openURL.mockRestore();
  jest.useRealTimers();
});

describe("CriticalAlert", () => {
  it("defaults to the glucose copy and mg/dL", () => {
    render(<CriticalAlert {...base} value={48} direction="low" />);
    expect(screen.getByText("critical.alertTitleLow")).toBeTruthy();
    expect(screen.getByText("48 mg/dL")).toBeTruthy();
  });

  it("shows BP copy and the BP reading for a critical BP (audit P4)", () => {
    render(
      <CriticalAlert
        {...base}
        value={190}
        direction="high"
        category="bp"
        valueLabel="190/120 mmHg"
      />,
    );
    expect(screen.getByText("critical.bp.alertTitleHigh")).toBeTruthy();
    expect(screen.getByText("critical.bp.alertBodyHigh")).toBeTruthy();
    expect(screen.getByText("190/120 mmHg")).toBeTruthy();
    expect(screen.queryByText(/mg\/dL/)).toBeNull();
  });

  describe("call target (audit P2)", () => {
    it("looks up the reading's profile and calls its priority-1 contact, with 112 second", () => {
      render(<CriticalAlert {...base} value={48} direction="low" />);
      expect(mockUsePriorityContact).toHaveBeenCalledWith("profile-1", true);

      fireEvent.press(screen.getByText("critical.callContact"));
      expect(openURL).toHaveBeenLastCalledWith("tel:+919800000000");
      fireEvent.press(screen.getByText("critical.callEmergency"));
      expect(openURL).toHaveBeenLastCalledWith("tel:112");
    });

    it("with no emergency contact, offers 112 only", () => {
      mockUsePriorityContact.mockReturnValue(null);
      render(<CriticalAlert {...base} value={48} direction="low" />);
      expect(screen.queryByText("critical.callContact")).toBeNull();
      fireEvent.press(screen.getByText("critical.callEmergency"));
      expect(openURL).toHaveBeenLastCalledWith("tel:112");
    });
  });

  describe("60-second auto-dial (CLAUDE.md Edge Case #1)", () => {
    it("opens the dialer to the priority-1 contact after 60s with no tap", () => {
      render(<CriticalAlert {...base} value={48} direction="low" />);
      expect(screen.getByText("critical.autoDialHint")).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(59_000);
      });
      expect(openURL).not.toHaveBeenCalled();
      act(() => {
        jest.advanceTimersByTime(1_000);
      });
      expect(openURL).toHaveBeenCalledTimes(1);
      expect(openURL).toHaveBeenCalledWith("tel:+919800000000");
      expect(track).toHaveBeenCalledWith("critical_alert_auto_call_triggered", {
        contact_id: "contact-1",
      });
    });

    it("any tap on the alert cancels it", () => {
      render(<CriticalAlert {...base} value={48} direction="low" />);
      act(() => {
        jest.advanceTimersByTime(20_000);
      });
      fireEvent(screen.getByTestId("critical-alert-root"), "touchStart");
      expect(screen.queryByText("critical.autoDialHint")).toBeNull();
      // Says so, rather than silently vanishing.
      expect(screen.getByText("critical.autoDialOff")).toBeTruthy();
      expect(track).toHaveBeenCalledWith("critical_alert_autodial_cancelled");
      act(() => {
        jest.advanceTimersByTime(120_000);
      });
      expect(openURL).not.toHaveBeenCalled();
    });

    it("treats a contact without a real number as no contact", () => {
      mockUsePriorityContact.mockReturnValue({ id: "junk", name: "Junk", phone: "+" });
      render(<CriticalAlert {...base} value={48} direction="low" />);
      expect(screen.queryByText("critical.callContact")).toBeNull();
      expect(screen.queryByText("critical.autoDialHint")).toBeNull();
      act(() => {
        jest.advanceTimersByTime(120_000);
      });
      expect(openURL).not.toHaveBeenCalled();
    });

    it("a dialer that fails to open is logged, not thrown (review W3)", async () => {
      openURL.mockRejectedValueOnce(new Error("no dialer"));
      render(<CriticalAlert {...base} value={48} direction="low" />);
      fireEvent.press(screen.getByText("critical.callEmergency"));
      await act(async () => {
        await Promise.resolve();
      });
      expect(logError).toHaveBeenCalledWith("criticalAlert.dial", expect.any(Error));
    });

    it("a new alert (new alertKey) starts its own auto-dial, even after a touch (review C2)", () => {
      const view = render(<CriticalAlert {...base} alertKey={1} value={48} direction="low" />);
      fireEvent(screen.getByTestId("critical-alert-root"), "touchStart");
      view.rerender(<CriticalAlert {...base} alertKey={2} value={45} direction="low" />);
      expect(screen.getByText("critical.autoDialHint")).toBeTruthy();
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(openURL).toHaveBeenCalledWith("tel:+919800000000");
    });

    it("never auto-dials 112 when there is no contact", () => {
      mockUsePriorityContact.mockReturnValue(null);
      render(<CriticalAlert {...base} value={48} direction="low" />);
      act(() => {
        jest.advanceTimersByTime(120_000);
      });
      expect(openURL).not.toHaveBeenCalled();
    });

    it("does not run while the alert is hidden", () => {
      render(<CriticalAlert {...base} visible={false} value={48} direction="low" />);
      act(() => {
        jest.advanceTimersByTime(120_000);
      });
      expect(openURL).not.toHaveBeenCalled();
    });
  });

  describe("every category and the guardian variant (audit P3)", () => {
    it.each([
      ["cardiac", "hr_low", "72 bpm"],
      ["cardiac", "chest_pain", "80 bpm"],
      ["respiratory", "severe_symptom", undefined],
    ] as const)("%s / %s shows that category's copy", (category, reasonKey, valueLabel) => {
      render(
        <CriticalAlert
          {...base}
          category={category}
          reasonKey={reasonKey}
          {...(valueLabel ? { valueLabel } : {})}
        />,
      );
      expect(screen.getByText(`critical.${category}.title.${reasonKey}`)).toBeTruthy();
      expect(screen.getByText(`critical.${category}.body.${reasonKey}`)).toBeTruthy();
      if (valueLabel) expect(screen.getByText(valueLabel)).toBeTruthy();
      expect(screen.queryByText(/mg\/dL/)).toBeNull();
    });

    it("a guardian alert shows the push's own copy, opens details, and can be closed at once", () => {
      mockUsePriorityContact.mockReturnValue(null);
      const onOpenDetails = jest.fn();
      const onDismiss = jest.fn();
      render(
        <CriticalAlert
          visible
          userId={null}
          audience="guardian"
          category="glucose"
          title="Papa: Sugar Bahut Kam"
          body="Sugar 48 — call now"
          onOpenDetails={onOpenDetails}
          onDismiss={onDismiss}
        />,
      );
      expect(screen.getByText("Papa: Sugar Bahut Kam")).toBeTruthy();
      fireEvent.press(screen.getByText("critical.openDetails"));
      expect(onOpenDetails).toHaveBeenCalled();
      fireEvent.press(screen.getByText("critical.close"));
      expect(onDismiss).toHaveBeenCalled();
      fireEvent.press(screen.getByText("critical.callEmergency"));
      expect(openURL).toHaveBeenLastCalledWith("tel:112");
    });

    it("the patient's alert still can't be closed for 30s", () => {
      render(<CriticalAlert {...base} value={48} direction="low" />);
      expect(screen.queryByText("critical.close")).toBeNull();
      expect(screen.getByText("critical.waitDismiss")).toBeTruthy();
    });
  });
});
