import { describe, expect, it } from "vitest";
import { calendarWindow, nextCalendarMonths, requiredCalendarHorizon, historicalCalendarMonths, historicalMonthDates } from "./rateCalendarWindow";
import { canEditCalendarDate } from "./rateCalendarPresentation";

describe("bounded rate-calendar navigation", () => {
  it("opens on exactly 30 dates, inclusive, even across months", () => {
    const days = calendarWindow("2026-09-22", null);
    expect(days).toHaveLength(30);
    expect(days[0]).toBe("2026-09-22");
    expect(days.at(-1)).toBe("2026-10-21");
    expect(requiredCalendarHorizon("2026-09-22", null)).toBe(30);
  });

  it("selects precisely an explicit future month", () => {
    const days = calendarWindow("2026-09-22", "2026-10");
    expect(days).toHaveLength(31);
    expect(days[0]).toBe("2026-10-01");
    expect(days.at(-1)).toBe("2026-10-31");
    expect(requiredCalendarHorizon("2026-09-22", "2026-10")).toBe(40);
  });

  it("shows only remaining dates for the current month and handles leap years", () => {
    expect(calendarWindow("2026-09-22", "2026-09")).toHaveLength(9);
    expect(calendarWindow("2028-01-25", "2028-02")).toHaveLength(29);
    expect(calendarWindow("2027-01-25", "2027-02")).toHaveLength(28);
  });

  it("generates month chips without relying on fetched price data", () => {
    const months = nextCalendarMonths("2026-12-20");
    expect(months).toHaveLength(12);
    expect(months[0]).toEqual({ value: "2026-12", label: "Dec 26" });
    expect(months[1]).toEqual({ value: "2027-01", label: "Jan 27" });
    expect(months.at(-1)?.value).toBe("2027-11");
  });

  it("bounds the published-RPC horizon and safely handles an old month", () => {
    expect(requiredCalendarHorizon("2026-09-22", "2026-08")).toBe(30);
    expect(requiredCalendarHorizon("2026-09-22", "2029-12")).toBe(365);
    expect(() => calendarWindow("2026-09-22", "2026-13")).toThrow();
  });
  it("reveals exactly three read-only dates without shortening the next 30 nights", () => {
    const dates = calendarWindow("2026-10-20", null, true);
    expect(dates).toHaveLength(33);
    expect(dates.slice(0, 3)).toEqual(["2026-10-17", "2026-10-18", "2026-10-19"]);
    expect(dates[3]).toBe("2026-10-20");
    expect(dates.at(-1)).toBe("2026-11-18");
    expect(requiredCalendarHorizon("2026-10-20", null)).toBe(30);
  });

  it("supports three historical dates within and across current month boundaries", () => {
    const current = calendarWindow("2026-10-20", "2026-10", true);
    expect(current.slice(0, 4)).toEqual(["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
    expect(current.at(-1)).toBe("2026-10-31");

    const crossover = calendarWindow("2027-01-02", "2027-01", true);
    expect(crossover.slice(0, 4)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
    expect(calendarWindow("2027-01-02", "2027-02", true)[0]).toBe("2027-02-01");
  });

  it("opens on the prior three nights across October–November without changing the 30-night future horizon", () => {
    const today = "2026-11-01";
    const dates = calendarWindow(today, null, true);
    expect(dates).toHaveLength(33);
    expect(dates.slice(0, 4)).toEqual(["2026-10-29", "2026-10-30", "2026-10-31", today]);
    expect(dates.at(-1)).toBe("2026-11-30");
    expect(requiredCalendarHorizon(today, null)).toBe(30);
    expect(dates.slice(0, 3).every(date => !canEditCalendarDate(date, today, true))).toBe(true);
    expect(canEditCalendarDate(today, today, true)).toBe(true);
  });


  it("provides 25 historical month choices covering the previous two years without loading prices", () => {
    const months = historicalCalendarMonths("2026-11-01");
    expect(months).toHaveLength(25);
    expect(months[0]).toEqual({ value: "2026-11", label: "November 2026" });
    expect(months.at(-1)?.value).toBe("2024-11");
  });

  it("historical month includes only past, read-only dates and respects retention", () => {
    const dates = historicalMonthDates("2026-11-18", "2026-11");
    expect(dates).toHaveLength(17);
    expect(dates[0]).toBe("2026-11-01");
    expect(dates.at(-1)).toBe("2026-11-17");
    expect(historicalMonthDates("2026-11-01", "2026-11")).toEqual([]);
    expect(historicalMonthDates("2026-11-18", "2026-10")).toHaveLength(31);
    expect(historicalMonthDates("2026-11-18", "2024-10")).toEqual([]);
    expect(historicalMonthDates("2026-11-18", "2025-99")).toEqual([]);
    expect(historicalMonthDates("2026-11-18", "2026-12")).toEqual([]);
  });


  it("starts November 2 with October 30, 31 and November 1 visible, while today remains editable", () => {
    const today = "2026-11-02";
    const dates = calendarWindow(today, null, true);
    expect(dates).toHaveLength(33);
    expect(dates.slice(0, 4)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", today]);
    expect(dates.at(-1)).toBe("2026-12-01");
    expect(dates.slice(0, 3).every(date => !canEditCalendarDate(date, today, true))).toBe(true);
    expect(canEditCalendarDate(today, today, true)).toBe(true);
  });

});
