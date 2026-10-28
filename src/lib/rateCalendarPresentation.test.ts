import { describe, expect, it } from "vitest";
import {
  canEditCalendarDate, historicalRateKey, historyStart, rateCalendarColumnWidth,
} from "./rateCalendarPresentation";

describe("rate calendar history and layout", () => {
  it("moves back three calendar days, including across month/year boundaries", () => {
    expect(historyStart("2026-10-20")).toBe("2026-10-17");
    expect(historyStart("2027-01-02")).toBe("2026-12-30");
    expect(historyStart("2028-03-02")).toBe("2028-02-28");
  });

  it("never allows historical dates to be edited, even by managers", () => {
    expect(canEditCalendarDate("2026-10-19", "2026-10-20", true)).toBe(false);
    expect(canEditCalendarDate("2026-10-20", "2026-10-20", true)).toBe(true);
    expect(canEditCalendarDate("2026-10-21", "2026-10-20", false)).toBe(false);
  });

  it("maintains the same legible column width for rolling and month views", () => {
    expect(rateCalendarColumnWidth(390, 124, 60)).toBe(60); // iPhone: horizontal scroll
    expect(rateCalendarColumnWidth(390, 124, 60)).toBeGreaterThan(34);
    expect(rateCalendarColumnWidth(2400, 200, 60)).toBe(73); // wide office display
    expect(rateCalendarColumnWidth(390, 124, 84)).toBe(84); // user zoom respected
  });

  it("separates hotel price keys by guest count, room and date", () => {
    expect(historicalRateKey("OTTO_4", 2, "2026-10-19"))
      .not.toBe(historicalRateKey("OTTO_4", 1, "2026-10-19"));
  });
});
