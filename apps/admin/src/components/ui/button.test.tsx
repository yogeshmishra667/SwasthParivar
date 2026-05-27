import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Button } from "./button.js";

describe("Button Component", () => {
  it("renders correctly with text", () => {
    render(<Button>Click Me</Button>);
    expect(screen.getByRole("button", { name: "Click Me" })).toBeInTheDocument();
  });

  it("applies the default variant and size classes", () => {
    render(<Button>Default</Button>);
    const button = screen.getByRole("button", { name: "Default" });
    expect(button).toHaveClass("bg-primary");
    expect(button).toHaveClass("text-primary-foreground");
    expect(button).toHaveClass("h-9"); // default size
  });

  it("applies variant and size classes correctly", () => {
    render(
      <Button variant="destructive" size="lg">
        Delete
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveClass("bg-destructive");
    expect(button).toHaveClass("text-destructive-foreground");
    expect(button).toHaveClass("h-10"); // lg size
  });

  it("is disabled when disabled prop is true", () => {
    render(<Button disabled>Disabled</Button>);
    const button = screen.getByRole("button", { name: "Disabled" });
    expect(button).toBeDisabled();
    expect(button).toHaveClass("disabled:opacity-50");
  });

  it("fires onClick handler when clicked", () => {
    let clicked = false;
    render(<Button onClick={() => (clicked = true)}>Clickable</Button>);
    const button = screen.getByRole("button", { name: "Clickable" });
    fireEvent.click(button);
    expect(clicked).toBe(true);
  });

  it("renders as a different child element when asChild is true", () => {
    render(
      <Button asChild>
        <a href="/test">Link Button</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Link Button" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/test");
    // Should still have button styling classes
    expect(link).toHaveClass("inline-flex");
    expect(link).toHaveClass("items-center");
  });
});
