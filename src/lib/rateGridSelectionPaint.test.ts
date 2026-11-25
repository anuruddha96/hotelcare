import { describe, expect, it } from "vitest";
import { PRICE_RANGE_CLASSES, setPriceCellPainted, syncPriceCellSelection } from "./rateGridSelectionPaint";

const button = () => document.createElement("button");
const painted = (cell: HTMLButtonElement) =>
  PRICE_RANGE_CLASSES.every((className) => cell.classList.contains(className));

describe("Rate & Pickup drag selection painting", () => {
  it("highlights the starting cell and all cells inside the drag", () => {
    const first = button();
    const next = button();
    const elements = new Map([["0:0", first], ["0:1", next]]);
    const selected = new Set(["0:0", "0:1"]);

    syncPriceCellSelection(elements, new Set(), selected);
    expect(painted(first)).toBe(true);
    expect(painted(next)).toBe(true);
  });

  it("repaints an unchanged selection if a starting button is replaced", () => {
    const original = button();
    const another = button();
    const elements = new Map([["0:0", original], ["0:1", another]]);
    const selected = new Set(["0:0", "0:1"]);
    syncPriceCellSelection(elements, new Set(), selected);

    const replacement = button();
    elements.set("0:0", replacement);
    // Drag coordinates have not changed, but React created a new button.
    syncPriceCellSelection(elements, selected, selected);

    expect(painted(replacement)).toBe(true);
    expect(painted(another)).toBe(true);
  });

  it("restores a selected cell whose className was overwritten by React", () => {
    const cell = button();
    const elements = new Map([["1:2", cell]]);
    const selected = new Set(["1:2"]);
    syncPriceCellSelection(elements, new Set(), selected);
    cell.className = "price-cell";
    syncPriceCellSelection(elements, selected, selected);
    expect(painted(cell)).toBe(true);
  });

  it("clears removed cells without disturbing the remaining ones", () => {
    const first = button();
    const second = button();
    const elements = new Map([["0:0", first], ["0:1", second]]);
    const before = new Set(["0:0", "0:1"]);
    syncPriceCellSelection(elements, new Set(), before);
    const after = new Set(["0:1"]);
    syncPriceCellSelection(elements, before, after);
    expect(painted(first)).toBe(false);
    expect(first.style.transitionProperty).toBe("");
    expect(painted(second)).toBe(true);
    setPriceCellPainted(second, false);
    expect(painted(second)).toBe(false);
  });
});
