import { render, screen, fireEvent, waitFor } from "@testing-library/react-native";

import { DoctorFormModal } from "@/components/appointments/DoctorFormModal";
import { createDoctor } from "@/services/doctor-portal";

// i18n mock (jest.setup.ts) returns keys verbatim, so we assert on stable
// key identifiers rather than translated copy.

jest.mock("@/services/doctor-portal", () => ({
  createDoctor: jest.fn(),
}));
jest.mock("@/services/analytics", () => ({ logError: jest.fn() }));

const mockedCreate = createDoctor as jest.MockedFunction<typeof createDoctor>;

const noop = (): void => undefined;

describe("DoctorFormModal", () => {
  afterEach(() => jest.clearAllMocks());

  it("blocks submit and shows an error when the name is empty", () => {
    render(<DoctorFormModal visible targetUserId={undefined} onClose={noop} onCreated={noop} />);
    fireEvent.press(screen.getByText("doctorPortal.doctorForm.save"));
    expect(screen.getByText("doctorPortal.doctorForm.missingName")).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("rejects a malformed phone before any network call", () => {
    render(<DoctorFormModal visible targetUserId={undefined} onClose={noop} onCreated={noop} />);
    fireEvent.changeText(
      screen.getByPlaceholderText("doctorPortal.doctorForm.namePlaceholder"),
      "Dr. Mehta",
    );
    fireEvent.changeText(
      screen.getByPlaceholderText("doctorPortal.doctorForm.specialtyPlaceholder"),
      "Diabetes",
    );
    fireEvent.changeText(screen.getByPlaceholderText("+9198…"), "98123");
    fireEvent.press(screen.getByText("doctorPortal.doctorForm.save"));
    expect(screen.getByText("doctorPortal.doctorForm.invalidPhone")).toBeTruthy();
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it("creates the doctor and forwards the result on a valid submit", async () => {
    const created = {
      id: "doc-1",
      userId: "u-1",
      name: "Dr. Mehta",
      specialty: "Diabetes",
      clinicName: null,
      phone: null,
      createdAt: "2026-06-13T00:00:00.000Z",
    };
    mockedCreate.mockResolvedValueOnce(created);
    const onCreated = jest.fn();

    render(<DoctorFormModal visible targetUserId="sub-7" onClose={noop} onCreated={onCreated} />);
    fireEvent.changeText(
      screen.getByPlaceholderText("doctorPortal.doctorForm.namePlaceholder"),
      "Dr. Mehta",
    );
    fireEvent.changeText(
      screen.getByPlaceholderText("doctorPortal.doctorForm.specialtyPlaceholder"),
      "Diabetes",
    );
    fireEvent.press(screen.getByText("doctorPortal.doctorForm.save"));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(mockedCreate).toHaveBeenCalledWith({
      name: "Dr. Mehta",
      specialty: "Diabetes",
      clinicName: undefined,
      phone: undefined,
      targetUserId: "sub-7",
    });
  });
});
