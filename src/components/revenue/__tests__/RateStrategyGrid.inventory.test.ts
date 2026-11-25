import { describe, expect, it } from "vitest";
import { manualInventoryDelta } from "../RateStrategyGrid";

describe("manualInventoryDelta", () => {
  it("matches Previo's +1 manual availability marker", () => {
    // 5 physical rooms - 4 booked = 1 automatic; Previo final = 2 => +1.
    expect(manualInventoryDelta(2, 5, 4)).toBe(1);
  });

  it("shows a negative manual adjustment when a room is removed from sale", () => {
    // 5 physical rooms - 4 booked = 1 automatic; final = 0 => -1.
    expect(manualInventoryDelta(0, 5, 4)).toBe(-1);
  });

  it("returns zero when Previo availability matches reservations", () => {
    expect(manualInventoryDelta(1, 5, 4)).toBe(0);
  });

  it("never treats over-occupancy as negative automatic availability", () => {
    expect(manualInventoryDelta(0, 5, 6)).toBe(0);
  });
});
