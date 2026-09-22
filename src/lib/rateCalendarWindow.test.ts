import { describe, expect, it } from "vitest";
import { calendarWindow, nextCalendarMonths, requiredCalendarHorizon } from "./rateCalendarWindow";

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
});
