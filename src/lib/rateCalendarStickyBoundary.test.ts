import { describe, expect, it } from "vitest";
import { shouldPinRateSummary } from "./rateCalendarStickyBoundary";

describe("Reliable Rate & Pickup summary freeze", () => {
  it("does not pin before the reader reaches the rate calendar", () => {
    expect(shouldPinRateSummary({
      anchorTop: 350, appHeaderBottom: 145, lastRateBottom: 1800, summaryHeight: 130,
    })).toBe(false);
  });

  it("pins throughout middle rate plans in portrait and desktop layouts", () => {
    for (const appHeaderBottom of [90, 145]) {
      expect(shouldPinRateSummary({
        anchorTop: -420, appHeaderBottom, lastRateBottom: 950, summaryHeight: 130,
      })).toBe(true);
    }
  });

  it("releases when the final rate plan reaches the frozen header", () => {
    expect(shouldPinRateSummary({
      anchorTop: -900, appHeaderBottom: 145, lastRateBottom: 275, summaryHeight: 130,
    })).toBe(false);
  });

  it("pins again when scrolling back up through rate plans", () => {
    expect(shouldPinRateSummary({
      anchorTop: -900, appHeaderBottom: 145, lastRateBottom: 320, summaryHeight: 130,
    })).toBe(true);
  });

  it("fails safely on unmeasured or degenerate geometry", () => {
    expect(shouldPinRateSummary({
      anchorTop: NaN, appHeaderBottom: 145, lastRateBottom: 500, summaryHeight: 130,
    })).toBe(false);
    expect(shouldPinRateSummary({
      anchorTop: 0, appHeaderBottom: 145, lastRateBottom: 500, summaryHeight: 0,
    })).toBe(false);
  });
});
