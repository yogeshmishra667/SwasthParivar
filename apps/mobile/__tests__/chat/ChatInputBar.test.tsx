import { render, screen, fireEvent } from "@testing-library/react-native";
import { SendButton } from "@/components/chat/SendButton";
import { ChatInputBar } from "@/components/chat/ChatInputBar";

// VoiceButton lazy-loads its native impl via a dynamic import(), which
// Jest's CommonJS runtime can't execute. ChatInputBar's behaviour does
// not depend on the mic — stub it out.
jest.mock("@/components/chat/VoiceButton", () => ({
  VoiceButton: (): null => null,
}));

describe("SendButton", () => {
  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    render(<SendButton onPress={onPress} loading={false} />);
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress while loading", () => {
    const onPress = jest.fn();
    render(<SendButton onPress={onPress} loading />);
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe("ChatInputBar", () => {
  it("shows the rate-limit message when the daily limit is reached", () => {
    render(
      <ChatInputBar onSend={jest.fn()} disabled={false} dailyRemaining={0} isOffline={false} />,
    );
    expect(screen.getByText("chat.rateLimit")).toBeTruthy();
    expect(screen.queryByPlaceholderText("chat.inputPlaceholder")).toBeNull();
  });

  it("shows the offline hint when offline", () => {
    render(<ChatInputBar onSend={jest.fn()} disabled={false} dailyRemaining={3} isOffline />);
    expect(screen.getByText("chat.offlineSend")).toBeTruthy();
  });

  it("sends the typed text via onSend", () => {
    const onSend = jest.fn().mockResolvedValue(undefined);
    render(<ChatInputBar onSend={onSend} disabled={false} dailyRemaining={3} isOffline={false} />);
    fireEvent.changeText(screen.getByPlaceholderText("chat.inputPlaceholder"), "sugar kaisi hai");
    fireEvent.press(screen.getByRole("button", { name: "chat.send" }));
    expect(onSend).toHaveBeenCalledWith("sugar kaisi hai");
  });
});
