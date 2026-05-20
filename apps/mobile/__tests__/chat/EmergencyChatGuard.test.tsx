import { Text } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { EmergencyChatGuard } from "@/components/chat/EmergencyChatGuard";

describe("EmergencyChatGuard", () => {
  it("renders children when no critical bypass is active", () => {
    render(
      <EmergencyChatGuard criticalBypassActive={false} onResolveCritical={jest.fn()}>
        <Text>chat content</Text>
      </EmergencyChatGuard>,
    );
    expect(screen.getByText("chat content")).toBeTruthy();
  });

  it("intercepts the surface and calls onResolveCritical when a bypass is active", () => {
    const onResolve = jest.fn();
    render(
      <EmergencyChatGuard criticalBypassActive onResolveCritical={onResolve}>
        <Text>chat content</Text>
      </EmergencyChatGuard>,
    );
    expect(screen.queryByText("chat content")).toBeNull();
    fireEvent.press(screen.getByRole("button"));
    expect(onResolve).toHaveBeenCalledTimes(1);
  });
});
