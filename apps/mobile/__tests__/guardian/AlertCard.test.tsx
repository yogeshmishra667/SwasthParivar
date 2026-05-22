import { render, screen, fireEvent } from "@testing-library/react-native";
import { AlertCard } from "@/components/family/AlertCard";

describe("AlertCard", () => {
  it("renders the patient name and headline", () => {
    render(<AlertCard severity="orange" patientName="Ramesh" headline="Dawai chhoot rahi hai" />);
    expect(screen.getByText("Ramesh")).toBeTruthy();
    expect(screen.getByText("Dawai chhoot rahi hai")).toBeTruthy();
  });

  it("combines patient name and relationship in the header", () => {
    render(
      <AlertCard
        severity="orange"
        patientName="Ramesh"
        relationship="Papa"
        severityLabel="Needs attention"
        headline="h"
      />,
    );
    expect(screen.getByText("Ramesh — Papa")).toBeTruthy();
    expect(screen.getByText("Needs attention")).toBeTruthy();
  });

  it("is a tappable button only when onPress is given", () => {
    const onPress = jest.fn();
    const { rerender } = render(
      <AlertCard
        severity="orange"
        patientName="Ramesh"
        headline="h"
        ctaLabel="See"
        onPress={onPress}
      />,
    );
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender(<AlertCard severity="safe" patientName="Sushila" headline="All good" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the unread indicator only when unread", () => {
    render(<AlertCard severity="yellow" patientName="A" headline="h" unread />);
    expect(screen.getByLabelText("unread")).toBeTruthy();
  });

  it("hides the unread indicator when read", () => {
    render(<AlertCard severity="yellow" patientName="A" headline="h" />);
    expect(screen.queryByLabelText("unread")).toBeNull();
  });
});
