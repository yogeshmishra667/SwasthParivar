import { render, screen, fireEvent } from "@testing-library/react-native";

import { PendingPrescriptionsCard } from "@/components/dashboard/PendingPrescriptionsCard";
import type { PrescriptionListItem } from "@/services/prescriptions";

// i18n mock (jest.setup.ts) returns keys verbatim.

const item = (id: string): PrescriptionListItem => ({
  id,
  status: "pending_approval",
  createdAt: "2026-06-13T00:00:00.000Z",
  pendingItemCount: 2,
});

describe("PendingPrescriptionsCard", () => {
  it("renders nothing when there are no pending prescriptions", () => {
    const { toJSON } = render(<PendingPrescriptionsCard pending={[]} onPress={jest.fn()} />);
    expect(toJSON()).toBeNull();
  });

  it("opens the newest pending prescription on tap", () => {
    const onPress = jest.fn();
    // Server returns newest-first, so the first item is the newest.
    render(
      <PendingPrescriptionsCard pending={[item("rx-new"), item("rx-old")]} onPress={onPress} />,
    );
    fireEvent.press(screen.getByText("prescriptions.dashboard.tapToReview"));
    expect(onPress).toHaveBeenCalledWith("rx-new");
  });
});
