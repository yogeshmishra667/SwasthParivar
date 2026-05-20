import { render, screen, fireEvent } from "@testing-library/react-native";
import { MessageBubble } from "@/components/chat/MessageBubble";

const base = {
  id: "m1",
  content: "Aapki sugar theek hai",
  createdAt: new Date().toISOString(),
};

describe("MessageBubble", () => {
  it("renders content and a flag button on an assistant message", () => {
    render(
      <MessageBubble
        message={{ ...base, role: "assistant" }}
        tier="cached"
        flagged={false}
        flaggedByUser={false}
        onFlag={jest.fn()}
      />,
    );
    expect(screen.getByText("Aapki sugar theek hai")).toBeTruthy();
    expect(screen.queryByRole("button")).not.toBeNull();
  });

  it("does NOT render a flag button on a user message", () => {
    render(
      <MessageBubble
        message={{ ...base, role: "user" }}
        flagged={false}
        flaggedByUser={false}
        onFlag={jest.fn()}
      />,
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("calls onFlag with the message id when the flag button is tapped", () => {
    const onFlag = jest.fn();
    render(
      <MessageBubble
        message={{ ...base, role: "assistant" }}
        tier="sonnet"
        flagged={false}
        flaggedByUser={false}
        onFlag={onFlag}
      />,
    );
    fireEvent.press(screen.getByRole("button"));
    expect(onFlag).toHaveBeenCalledWith("m1");
  });
});
