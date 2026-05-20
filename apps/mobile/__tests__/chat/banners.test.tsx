import { render, screen, fireEvent } from "@testing-library/react-native";
import { AIDisclaimerBanner } from "@/components/chat/AIDisclaimerBanner";
import { OfflineChatBanner } from "@/components/chat/OfflineChatBanner";
import { CostTierBadge } from "@/components/chat/CostTierBadge";

describe("AIDisclaimerBanner", () => {
  it("renders the disclaimer and calls onDismiss when dismissed", () => {
    const onDismiss = jest.fn();
    render(<AIDisclaimerBanner onDismiss={onDismiss} />);
    expect(screen.getByText(/chat\.disclaimer/)).toBeTruthy();
    fireEvent.press(screen.getByRole("button"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe("OfflineChatBanner", () => {
  it("renders nothing when online", () => {
    render(<OfflineChatBanner isOffline={false} />);
    expect(screen.queryByText("chat.offlineBanner")).toBeNull();
  });

  it("renders the banner when offline", () => {
    render(<OfflineChatBanner isOffline />);
    expect(screen.getByText("chat.offlineBanner")).toBeTruthy();
  });
});

describe("CostTierBadge", () => {
  it("renders the tier label when visible", () => {
    render(<CostTierBadge tier="cached" visible />);
    expect(screen.getByText("chat.tier.cached")).toBeTruthy();
  });

  it("renders nothing when not visible (hidden outside dev builds)", () => {
    render(<CostTierBadge tier="sonnet" visible={false} />);
    expect(screen.queryByText("chat.tier.sonnet")).toBeNull();
  });
});
