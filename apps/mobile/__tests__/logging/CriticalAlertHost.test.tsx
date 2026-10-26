// Audit P3 — the root layout's one fullscreen alert, fed by the store.
jest.mock("@/hooks/usePriorityContact", () => ({ usePriorityContact: () => null }));
jest.mock("@/services/analytics", () => ({ track: jest.fn(), logError: jest.fn() }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import { CriticalAlertHost } from "@/components/logging/CriticalAlertHost";
import { useCriticalAlertStore } from "@/stores/critical-alert.store";

beforeEach(() => {
  useCriticalAlertStore.setState({
    current: null,
    queue: [],
    lastLocalRaise: {},
    shownReadingIds: [],
  });
});

describe("CriticalAlertHost", () => {
  it("shows the raised alert", () => {
    render(<CriticalAlertHost />);
    expect(screen.queryByText("critical.cardiac.title.hr_low")).toBeNull();
    act(() => {
      useCriticalAlertStore.getState().raise({
        audience: "patient",
        userId: "maa",
        category: "cardiac",
        reasonKey: "hr_low",
        valueLabel: "35 bpm",
      });
    });
    expect(screen.getByText("critical.cardiac.title.hr_low")).toBeTruthy();
    expect(screen.getByText("35 bpm")).toBeTruthy();
  });

  it("a guardian's 'see details' closes the alert and opens the patient", () => {
    render(<CriticalAlertHost />);
    act(() => {
      useCriticalAlertStore.getState().raiseFromPush(
        {
          audience: "guardian",
          userId: null,
          category: "glucose",
          direction: "low",
          patientId: "ramesh-ji",
          title: "Ramesh ji: Sugar Bahut Kam",
          body: "Sugar 48",
        },
        "r1",
      );
    });
    fireEvent.press(screen.getByText("critical.openDetails"));
    expect(useCriticalAlertStore.getState().current).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: "/patient/[id]",
      params: { id: "ramesh-ji" },
    });
  });
});
