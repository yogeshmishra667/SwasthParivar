import { render, screen, fireEvent, act } from "@testing-library/react-native";
import { TypingIndicator } from "@/components/chat/TypingIndicator";

describe("TypingIndicator", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("renders nothing when not visible", () => {
    render(<TypingIndicator visible={false} onRetry={jest.fn()} />);
    expect(screen.queryByText("chat.typing")).toBeNull();
  });

  it("shows the typing message while visible", () => {
    render(<TypingIndicator visible onRetry={jest.fn()} />);
    expect(screen.getByText("chat.typing")).toBeTruthy();
  });

  it("swaps to a retry prompt after the 12s timeout and calls onRetry", () => {
    const onRetry = jest.fn();
    render(<TypingIndicator visible onRetry={onRetry} />);
    act(() => {
      jest.advanceTimersByTime(12_000);
    });
    expect(screen.getByText("chat.typingTimeout")).toBeTruthy();
    fireEvent.press(screen.getByRole("button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
