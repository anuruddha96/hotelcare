import { describe, expect, it } from "vitest";
import {
  buildPeriodRevenueSalesGoals,
  inclusiveCalendarDays,
  periodTotalToDaily,
} from "./revenueSalesGoals";

describe("revenue sales goal period scaling", () => {
  it("counts selected booking-created dates inclusively", () => {
    expect(inclusiveCalendarDays("2026-08-01", "2026-08-31")).toBe(31);
    expect(inclusiveCalendarDays("2026-09-09", "2026-09-15")).toBe(7);
    expect(inclusiveCalendarDays("2026-09-15", "2026-09-15")).toBe(1);
  });

  it("keeps ADR fixed while scaling room-night and revenue targets", () => {
    const period = buildPeriodRevenueSalesGoals({
      targetAdr: 100,
      targetRoomNights: 30,
      targetValue: 3000,
      promoBudget: 0,
    }, "2026-08-01", "2026-08-31");

    expect(period.days).toBe(31);
    expect(period.targetAdr).toBe(100);
    expect(period.targetRoomNights).toBe(930);
    expect(period.targetValue).toBe(93000);
    expect(period.promoBudget).toBeNull();
    expect(period.targetValueIsDerived).toBe(false);
  });

  it("derives booking-value target from ADR x room nights when no override is configured", () => {
    const period = buildPeriodRevenueSalesGoals({
      targetAdr: 100,
      targetRoomNights: 30,
      targetValue: 0,
      promoBudget: 20,
    }, "2026-08-01", "2026-08-31");

    expect(period.targetValue).toBe(93000);
    expect(period.targetValueIsDerived).toBe(true);
    expect(period.promoBudget).toBe(620);
  });

  it("normalizes edited selected-period totals back to a daily baseline", () => {
    expect(periodTotalToDaily(930, 31)).toBe(30);
    expect(periodTotalToDaily(93000, 31)).toBe(3000);
  });
});
