import { render, screen } from "@testing-library/react-native";

import { CriticalAlert } from "@/components/logging/CriticalAlert";

// The i18n mock (jest.setup.ts) returns keys verbatim.
const base = {
  visible: true,
  contactName: "Beta",
  contactPhone: "+919800000000",
  onDismiss: jest.fn(),
};

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
});
