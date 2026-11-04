import { describe, expect, it } from "vitest";
import { rateCalendarPagePinOffset } from "./rateCalendarPagePin";

describe("Rate & Pickup page-level frozen decision summary", () => {
  it("stays in its normal place until the table reaches the app header", () => {
    expect(rateCalendarPagePinOffset({
      paneTop: 350, stickyTop: 95, summaryHeight: 135, lastRateBottom: 1600,
    })).toBe(0);
  });

  it("follows page scrolling under the sticky HotelCare header", () => {
    expect(rateCalendarPagePinOffset({
      paneTop: -450, stickyTop: 95, summaryHeight: 135, lastRateBottom: 1100,
    })).toBe(545);
  });

  it("releases at the last rate-plan row, before ADR and RevPAR", () => {
    expect(rateCalendarPagePinOffset({
      paneTop: -1000, stickyTop: 95, summaryHeight: 135, lastRateBottom: 80,
    })).toBe(945);
  });

  it("does not pin a short table with no vertical room below the summary", () => {
    expect(rateCalendarPagePinOffset({
      paneTop: -100, stickyTop: 95, summaryHeight: 135, lastRateBottom: 25,
    })).toBe(0);
  });

  it("handles incomplete geometry without producing NaN transforms", () => {
    expect(rateCalendarPagePinOffset({
      paneTop: Number.NaN, stickyTop: 95, summaryHeight: 135, lastRateBottom: 1500,
    })).toBe(0);
  });
});
