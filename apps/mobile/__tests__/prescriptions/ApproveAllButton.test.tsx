import { render, screen, fireEvent, act } from "@testing-library/react-native";

import { ApproveAllButton } from "@/components/prescriptions/ApproveAllButton";

// The i18n mock (jest.setup.ts) returns keys verbatim, so we assert on
// stable key identifiers rather than translated copy.

describe("ApproveAllButton", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("approves in one tap when a guardian is the approver (frictionLevel none)", () => {
    const onApprove = jest.fn();
    render(<ApproveAllButton frictionLevel="none" onApprove={onApprove} />);
    fireEvent.press(screen.getByText("prescriptions.actions.approveAll"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("forces the solo re-confirm modal and a 3s read delay before approving", () => {
    jest.useFakeTimers();
    const onApprove = jest.fn();
    render(<ApproveAllButton frictionLevel="high" onApprove={onApprove} />);

    // First tap opens the modal — does NOT approve.
    fireEvent.press(screen.getByText("prescriptions.actions.approveAll"));
    expect(onApprove).not.toHaveBeenCalled();

    // The confirm button is in its countdown ("wait") state and disabled.
    fireEvent.press(screen.getByText("prescriptions.solo.wait"));
    expect(onApprove).not.toHaveBeenCalled();

    // After the 3-second delay the confirm button activates.
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    fireEvent.press(screen.getByText("prescriptions.solo.confirmYes"));
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("does not approve when the solo user backs out of the modal", () => {
    jest.useFakeTimers();
    const onApprove = jest.fn();
    render(<ApproveAllButton frictionLevel="high" onApprove={onApprove} />);
    fireEvent.press(screen.getByText("prescriptions.actions.approveAll"));
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    fireEvent.press(screen.getByText("prescriptions.solo.confirmNo"));
    expect(onApprove).not.toHaveBeenCalled();
  });

  it("is disabled while submitting", () => {
    const onApprove = jest.fn();
    render(<ApproveAllButton frictionLevel="none" submitting onApprove={onApprove} />);
    fireEvent.press(screen.getByText("prescriptions.actions.approving"));
    expect(onApprove).not.toHaveBeenCalled();
  });
});
