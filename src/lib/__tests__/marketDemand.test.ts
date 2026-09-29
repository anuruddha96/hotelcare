import { describe, expect, it } from "vitest";
import { buildMarketDemandBoard, scoreMarketDemand, type MarketDemandMetric } from "@/lib/marketDemand";

const today = "2026-09-29";

function metric(overrides: Partial<MarketDemandMetric> = {}): MarketDemandMetric {
  return {
    date: "2026-10-10",
    totalRooms: 300,
    roomsSold: 210,
    propertiesReporting: 5,
    propertiesOver80: 2,
    propertiesOver90: 1,
    propertiesLowInventory: 1,
    propertiesSoldOut: 0,
    pickup48h: 5,
    pickup7d: 18,
    eventImpacts: [],
    ...overrides,
  };
}

describe("shared market demand", () => {
  it("marks broad portfolio compression and pickup as very high demand", () => {
    const result = scoreMarketDemand(metric({
      totalRooms: 300,
      roomsSold: 270,
      propertiesOver80: 5,
      propertiesOver90: 4,
      propertiesLowInventory: 4,
      propertiesSoldOut: 1,
      pickup48h: 18,
      pickup7d: 45,
      eventImpacts: ["high"],
    }), today);

    expect(result.band).toBe("very_strong");
    expect(result.score).toBeGreaterThanOrEqual(85);
    expect(result.drivers[0]).toContain("90%");
  });

  it("does not let one compressed property overstate the whole Budapest market", () => {
    const result = scoreMarketDemand(metric({
      roomsSold: 165,
      propertiesOver80: 1,
      propertiesOver90: 1,
      propertiesLowInventory: 1,
      propertiesSoldOut: 1,
      pickup48h: 2,
      pickup7d: 8,
    }), today);

    expect(result.score).toBeLessThan(70);
    expect(result.band).not.toBe("very_strong");
    expect(result.band).not.toBe("strong");
  });

  it("uses occupancy breadth, pickup, lead time and events together", () => {
    const baseline = scoreMarketDemand(metric(), today);
    const stronger = scoreMarketDemand(metric({
      roomsSold: 240,
      propertiesOver80: 4,
      propertiesOver90: 2,
      propertiesLowInventory: 3,
      pickup48h: 12,
      pickup7d: 34,
      eventImpacts: ["medium", "high"],
    }), today);

    expect(stronger.score).toBeGreaterThan(baseline.score);
    expect(stronger.drivers.some((driver) => driver.includes("48h"))).toBe(true);
  });

  it("stays neutral when aggregate inventory is missing instead of inventing low demand", () => {
    const result = scoreMarketDemand(metric({
      totalRooms: 0,
      roomsSold: 0,
      propertiesReporting: 0,
      propertiesOver80: 0,
      propertiesOver90: 0,
      propertiesLowInventory: 0,
      propertiesSoldOut: 0,
      pickup48h: 0,
      pickup7d: 0,
    }), today);

    expect(result.score).toBe(50);
    expect(result.band).toBe("normal");
  });

  it("is tenant-independent: identical market aggregates create identical daily grades", () => {
    const input = [metric({ date: "2026-10-01" }), metric({ date: "2026-10-02", roomsSold: 255, propertiesOver80: 4 })];
    expect(buildMarketDemandBoard(input, today)).toEqual(buildMarketDemandBoard(input, today));
  });
});
