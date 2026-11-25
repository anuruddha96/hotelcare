import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BreakfastRecipes from "./BreakfastRecipes";

describe("BreakfastRecipes", () => {
  it("shows the two-serving milkshake instructions and changes the selected flavour", () => {
    render(<BreakfastRecipes language="en" />);
    expect(screen.getAllByText("Makes 2 servings").length).toBeGreaterThan(0);
    expect(screen.getByText("250 mL milk")).toBeTruthy();
    expect(screen.getByText("3 scoops of ice cream")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nutella" }));
    expect(screen.getByRole("heading", { name: "Nutella milkshake" })).toBeTruthy();
    expect(screen.getByText("Nutella, to taste")).toBeTruthy();
  });

  it("makes each of the three smoothie methods available", () => {
    render(<BreakfastRecipes language="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Smoothies" }));
    expect(screen.getByRole("button", { name: /Fruit juice smoothie/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Greek yogurt & milk smoothie/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Fruit-only smoothie/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Greek yogurt & milk smoothie/ }));
    expect(screen.getByText("3–4 tablespoons Greek yogurt")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Fruit-only smoothie/ }));
    expect(screen.getByText("Ripe, juicy fruit of the guest's choice")).toBeTruthy();
    expect(screen.queryByText("250 mL milk")).toBeNull();
  });

  it("supports Hungarian staff instructions", () => {
    render(<BreakfastRecipes language="hu" />);
    expect(screen.getByText("Italreceptek")).toBeTruthy();
    expect(screen.getByText("3 gombóc fagylalt")).toBeTruthy();
  });
});
