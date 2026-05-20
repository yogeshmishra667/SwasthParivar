import { render, screen, fireEvent } from "@testing-library/react-native";
import { FlagButton } from "@/components/chat/FlagButton";

describe("FlagButton", () => {
  it("renders an accessible button and fires onPress when tapped", () => {
    const onPress = jest.fn();
    render(<FlagButton onPress={onPress} />);
    fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
