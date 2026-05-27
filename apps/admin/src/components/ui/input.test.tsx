import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "./input.js";

describe("Input Component", () => {
  it("renders correctly", () => {
    render(<Input placeholder="Type here" />);
    expect(screen.getByPlaceholderText("Type here")).toBeInTheDocument();
  });

  it("handles user input", () => {
    let value = "";
    render(<Input placeholder="Enter value" onChange={(e) => (value = e.target.value)} />);
    const input = screen.getByPlaceholderText("Enter value");

    fireEvent.change(input, { target: { value: "Hello" } });
    expect(value).toBe("Hello");
    expect(input).toHaveValue("Hello");
  });

  it("is disabled when disabled prop is true", () => {
    render(<Input placeholder="Disabled" disabled />);
    const input = screen.getByPlaceholderText("Disabled");
    expect(input).toBeDisabled();
    expect(input).toHaveClass("disabled:cursor-not-allowed");
    expect(input).toHaveClass("disabled:opacity-50");
  });

  it("handles different types like password", () => {
    render(<Input type="password" placeholder="Password" />);
    const input = screen.getByPlaceholderText("Password");
    expect(input).toHaveAttribute("type", "password");
  });

  it("merges custom classes", () => {
    render(<Input className="custom-input" placeholder="Custom" />);
    const input = screen.getByPlaceholderText("Custom");
    expect(input).toHaveClass("custom-input");
    expect(input).toHaveClass("flex"); // from base classes
  });
});
