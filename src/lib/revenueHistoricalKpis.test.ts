import { describe, expect, it } from "vitest";
import { summarizeHistoricalKpis } from "./revenueHistoricalKpis";

describe("summarizeHistoricalKpis", () => {
  it("rolls up room nights, revenue, occupancy, ADR and RevPAR using weighted denominators", () => {
    const summary = summarizeHistoricalKpis([
      {
        stay_date: "2026-10-01",
        roomsSold: 5,
        roomsAvailable: 10,
        occupancyPct: 50,
        revenue: 500,
        adr: 100,
        revpar: 50,
      },
      {
        stay_date: "2026-10-02",
        roomsSold: 10,
        roomsAvailable: 20,
        occupancyPct: 50,
        revenue: 1500,
        adr: 150,
        revpar: 75,
      },
    ]);

    expect(summary).toEqual({
      days: 2,
      roomNights: 15,
      availableRoomNights: 30,
      revenue: 2000,
      occupancyPct: 50,
      adr: 133.33,
      revpar: 66.67,
    });
  });

  it("does not invent ADR, occupancy or RevPAR without their denominators", () => {
    expect(summarizeHistoricalKpis([
      {
        stay_date: "2026-10-03",
        roomsSold: 0,
        roomsAvailable: 0,
        occupancyPct: 0,
        revenue: 0,
        adr: null,
        revpar: null,
      },
    ])).toEqual({
      days: 1,
      roomNights: 0,
      availableRoomNights: 0,
      revenue: 0,
      occupancyPct: null,
      adr: null,
      revpar: null,
    });
  });

  it("is stable against invalid negative inputs", () => {
    const summary = summarizeHistoricalKpis([
      {
        stay_date: "2026-10-04",
        roomsSold: -2,
        roomsAvailable: 10,
        occupancyPct: -20,
        revenue: -100,
        adr: -50,
        revpar: -10,
      },
    ]);

    expect(summary.roomNights).toBe(0);
    expect(summary.availableRoomNights).toBe(10);
    expect(summary.revenue).toBe(0);
    expect(summary.occupancyPct).toBe(0);
    expect(summary.adr).toBeNull();
    expect(summary.revpar).toBe(0);
  });
});
