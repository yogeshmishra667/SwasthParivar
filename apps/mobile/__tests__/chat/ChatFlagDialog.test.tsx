import { render, screen, fireEvent } from "@testing-library/react-native";
import { ChatFlagDialog } from "@/components/chat/ChatFlagDialog";

describe("ChatFlagDialog", () => {
  it("does not submit until a reason is chosen", () => {
    const onSubmit = jest.fn();
    render(<ChatFlagDialog visible onClose={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.press(screen.getByRole("button", { name: "chat.flagDialog.submit" }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits the chosen reason", () => {
    const onSubmit = jest.fn();
    render(<ChatFlagDialog visible onClose={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.press(screen.getByRole("radio", { name: "chat.flagDialog.reasons.wrong_info" }));
    fireEvent.press(screen.getByRole("button", { name: "chat.flagDialog.submit" }));
    expect(onSubmit).toHaveBeenCalledWith("wrong_info", undefined);
  });
});
