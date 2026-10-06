import { describe, expect, it } from "vitest";
import { buildSalesPerformanceSeries, getSalesPerformancePace, shiftIsoYears } from "./revenueSalesPerformance";

describe("revenueSalesPerformance", () => {
  it("shows cancellations as negative activity and keeps cumulative net value", () => {
    const points = buildSalesPerformanceSeries({
      bookings: [
        { res_id: "b1", createdDay: "2026-10-06", createdMinutes: 405, roomNights: 2, revenue: 200, cancelled: false },
        { res_id: "c1", createdDay: "2026-10-06", createdMinutes: 450, roomNights: 1, revenue: 100, cancelled: true },
      ],
      from: "2026-10-06",
      to: "2026-10-06",
      today: "2026-10-06",
      nowMinutes: 480,
      compare: "goal",
      goals: { days: 1, targetValue: 1000, targetRoomNights: 10, targetAdr: 100 },
    });

    const eight = points.find((p) => p.label === "08:00");
    expect(eight).toBeTruthy();
    expect(eight?.grossValueWindow).toBe(200);
    expect(eight?.cancelledValueWindow).toBe(-100);
    expect(eight?.netValue).toBe(100);
    expect(eight?.netNights).toBe(1);
    expect(eight?.adr).toBe(100);
    expect(eight?.windowBookings).toBe(1);
    expect(eight?.windowCancellations).toBe(1);
  });

  it("uses one point per day for multi-day periods instead of mixing times of day", () => {
    const points = buildSalesPerformanceSeries({
      bookings: [
        { res_id: "a", createdDay: "2026-10-05", createdMinutes: 60, roomNights: 1, revenue: 120, cancelled: false },
        { res_id: "b", createdDay: "2026-10-06", createdMinutes: 900, roomNights: 2, revenue: 300, cancelled: false },
      ],
      from: "2026-10-05",
      to: "2026-10-06",
      today: "2026-10-06",
      nowMinutes: 900,
      compare: "goal",
      goals: { days: 2, targetValue: 400, targetRoomNights: 4, targetAdr: 100 },
    });

    expect(points).toHaveLength(2);
    expect(points[0].label).toBe("5 Oct");
    expect(points[0].netValue).toBe(120);
    expect(points[1].netValue).toBe(420);
    expect(points[1].compareValue).toBe(400);
  });

  it("compares against the same clock time on the previous day", () => {
    const points = buildSalesPerformanceSeries({
      bookings: [
        { res_id: "today", createdDay: "2026-10-06", createdMinutes: 420, roomNights: 2, revenue: 260, cancelled: false },
        { res_id: "yesterday", createdDay: "2026-10-05", createdMinutes: 410, roomNights: 1, revenue: 100, cancelled: false },
      ],
      from: "2026-10-06",
      to: "2026-10-06",
      today: "2026-10-06",
      nowMinutes: 480,
      compare: "yesterday",
      goals: { days: 1, targetValue: 0, targetRoomNights: 0, targetAdr: 0 },
    });

    const pace = getSalesPerformancePace(points, "value");
    expect(pace.current).toBe(260);
    expect(pace.benchmark).toBe(100);
    expect(pace.delta).toBe(160);
  });

  it("returns no goal benchmark when the relevant goal is unset", () => {
    const points = buildSalesPerformanceSeries({
      bookings: [
        { res_id: "today", createdDay: "2026-10-06", createdMinutes: 420, roomNights: 1, revenue: 130, cancelled: false },
      ],
      from: "2026-10-06",
      to: "2026-10-06",
      today: "2026-10-06",
      nowMinutes: 480,
      compare: "goal",
      goals: { days: 1, targetValue: 0, targetRoomNights: 0, targetAdr: 0 },
    });

    expect(getSalesPerformancePace(points, "value").benchmark).toBeNull();
    expect(getSalesPerformancePace(points, "nights").benchmark).toBeNull();
    expect(getSalesPerformancePace(points, "adr").benchmark).toBeNull();
  });

  it("compares the same calendar day in the previous month", () => {
    const points = buildSalesPerformanceSeries({
      bookings: [
        { res_id: "today", createdDay: "2026-10-06", createdMinutes: 420, roomNights: 2, revenue: 260, cancelled: false },
        { res_id: "last-month", createdDay: "2026-09-06", createdMinutes: 410, roomNights: 1, revenue: 140, cancelled: false },
      ],
      from: "2026-10-06",
      to: "2026-10-06",
      today: "2026-10-06",
      nowMinutes: 480,
      compare: "lastmonth",
      goals: { days: 1, targetValue: 0, targetRoomNights: 0, targetAdr: 0 },
    });

    const pace = getSalesPerformancePace(points, "value");
    expect(pace.current).toBe(260);
    expect(pace.benchmark).toBe(140);
    expect(pace.delta).toBe(120);
  });

  it("compares the same calendar day in the previous year", () => {
    const points = buildSalesPerformanceSeries({
      bookings: [
        { res_id: "today", createdDay: "2026-10-06", createdMinutes: 420, roomNights: 2, revenue: 260, cancelled: false },
        { res_id: "last-year", createdDay: "2025-10-06", createdMinutes: 410, roomNights: 3, revenue: 330, cancelled: false },
      ],
      from: "2026-10-06",
      to: "2026-10-06",
      today: "2026-10-06",
      nowMinutes: 480,
      compare: "lastyear",
      goals: { days: 1, targetValue: 0, targetRoomNights: 0, targetAdr: 0 },
    });

    const valuePace = getSalesPerformancePace(points, "value");
    expect(valuePace.current).toBe(260);
    expect(valuePace.benchmark).toBe(330);
    expect(valuePace.delta).toBe(-70);
    expect(getSalesPerformancePace(points, "nights").benchmark).toBe(3);
  });

  it("clamps leap-day year comparisons to the last valid February date", () => {
    expect(shiftIsoYears("2028-02-29", -1)).toBe("2027-02-28");
  });

  it("aligns custom comparison dates by day order", () => {
    const points = buildSalesPerformanceSeries({
      bookings: [
        { res_id: "a", createdDay: "2026-10-05", createdMinutes: 300, roomNights: 1, revenue: 100, cancelled: false },
        { res_id: "b", createdDay: "2026-10-06", createdMinutes: 300, roomNights: 1, revenue: 120, cancelled: false },
        { res_id: "ca", createdDay: "2026-08-15", createdMinutes: 300, roomNights: 1, revenue: 80, cancelled: false },
        { res_id: "cb", createdDay: "2026-08-16", createdMinutes: 300, roomNights: 1, revenue: 90, cancelled: false },
      ],
      from: "2026-10-05",
      to: "2026-10-06",
      today: "2026-10-06",
      nowMinutes: 480,
      compare: "custom",
      customCompareFrom: "2026-08-15",
      customCompareTo: "2026-08-16",
      goals: { days: 2, targetValue: 0, targetRoomNights: 0, targetAdr: 0 },
    });

    expect(points[0].compareValue).toBe(80);
    expect(points[1].compareValue).toBe(170);
  });

});
