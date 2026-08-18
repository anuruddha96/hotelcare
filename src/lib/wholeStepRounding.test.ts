import { describe, it, expect } from "vitest";
import { roundStep, roundWholePrice, applyRounding } from "../../supabase/functions/_shared/pricingRules";

describe("whole-number step amounts", () => {
  it("rounds a cap-clamped tier down to a whole unit", () => {
    // 25 EUR tier clamped by 19.55 of remaining daily room used to be applied
    // — and written into the history — as 19.55.
    expect(roundStep(19.55, true, "down")).toBe(19);
  });

  it("rounds a reported move to the nearest whole unit", () => {
    expect(roundStep(1.5, true, "nearest")).toBe(2);
    expect(roundStep(-1.5, true, "nearest")).toBe(-2);
  });

  it("keeps cents when the property did not ask for whole numbers", () => {
    expect(roundStep(19.55, false)).toBe(19.55);
  });

  it("turns a sub-unit scaled step into no move at all", () => {
    expect(roundStep(0.45, true, "down")).toBe(0);
  });

  it("still never rounds a markdown back up, nor an increase below the floor", () => {
    expect(roundWholePrice(220.4, "decrease")).toBe(220);
    expect(roundWholePrice(119.2, "increase", 120)).toBe(120);
    expect(applyRounding(221.6, "increase", true)).toBe(222);
  });
});
