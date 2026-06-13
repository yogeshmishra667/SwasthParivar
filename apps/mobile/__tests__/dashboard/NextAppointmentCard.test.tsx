import { render, screen, fireEvent } from "@testing-library/react-native";

import { NextAppointmentCard } from "@/components/dashboard/NextAppointmentCard";
import type { DoctorAppointmentDto } from "@/services/doctor-portal";

// i18n mock (jest.setup.ts) returns keys verbatim.

const appointment: DoctorAppointmentDto = {
  id: "appt-1",
  userId: "u-1",
  doctorId: "doc-1",
  scheduledAt: "2026-07-01T08:30:00.000Z",
  purpose: "Sugar review",
  status: "scheduled",
  preVisitReportId: null,
  createdAt: "2026-06-13T00:00:00.000Z",
};

describe("NextAppointmentCard", () => {
  it("renders nothing when there is no upcoming appointment", () => {
    const { toJSON } = render(
      <NextAppointmentCard appointment={null} doctorName="" onPress={jest.fn()} />,
    );
    expect(toJSON()).toBeNull();
  });

  it("shows the doctor name and is tappable when an appointment exists", () => {
    const onPress = jest.fn();
    render(
      <NextAppointmentCard appointment={appointment} doctorName="Dr. Mehta" onPress={onPress} />,
    );
    expect(screen.getByText("Dr. Mehta")).toBeTruthy();
    fireEvent.press(screen.getByText("Dr. Mehta"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("falls back to the purpose when the doctor name is unknown", () => {
    render(<NextAppointmentCard appointment={appointment} doctorName="" onPress={jest.fn()} />);
    expect(screen.getByText("Sugar review")).toBeTruthy();
  });
});
