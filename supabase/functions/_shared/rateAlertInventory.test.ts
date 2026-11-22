import { describe, expect, it } from "vitest";
import {
  filterRatesBySellableInventory,
  makeRateAlertPlanKey,
  MAX_RATE_ALERT_INVENTORY_AGE_MS,
} from "./rateAlertInventory";

const NOW = Date.parse("2026-11-22T19:30:00Z");
const rate = (obk_id: string | null, rate_plan_id = "188517", date = "2026-11-22") => ({
  stay_date: date, obk_id, rate_plan_id, closed_to_arrival: false,
  room_type_name: "Deluxe Single Room", price: 32,
});
const availability = (obk_id: string, count: number | null, time = "2026-11-22T19:00:00Z", date = "2026-11-22") => ({
  stay_date: date, obk_id, availability: count, captured_at: time,
});

describe("unusual-rate email: active inventory only", () => {
  it("does not email for the actual sold-out Memories Deluxe Single, even if another room is available", () => {
    const result = filterRatesBySellableInventory(
      [rate("816341")],
      [availability("816341", 0), availability("823173", 6)],
      NOW,
    );
    expect(result.sellable).toEqual([]);
    expect(result.soldOut).toBe(1);
  });

  it("alerts for the exact date and room type when positive inventory exists", () => {
    const candidate = rate("816341");
    const result = filterRatesBySellableInventory(
      [candidate],
      [availability("816341", 1)],
      NOW,
    );
    expect(result.sellable).toEqual([candidate]);
  });

  it("does not borrow inventory from another date, room type or rate plan", () => {
    const result = filterRatesBySellableInventory(
      [rate("816341", "188517", "2026-11-23"), rate(null)],
      [availability("816341", 3), availability("817629", 4)],
      NOW,
    );
    expect(result.sellable).toEqual([]);
    expect(result.unverified).toBe(2);
  });

  it("prefers the newest observation and handles 0-to-available reopening", () => {
    const result = filterRatesBySellableInventory(
      [rate("816341")],
      [
        availability("816341", 0, "2026-11-22T18:00:00Z"),
        availability("816341", 2, "2026-11-22T19:00:00Z"),
      ],
      NOW,
    );
    expect(result.sellable).toHaveLength(1);
  });

  it("never sends pricing email when inventory is missing, null or stale", () => {
    const stale = new Date(NOW - MAX_RATE_ALERT_INVENTORY_AGE_MS - 1000).toISOString();
    const result = filterRatesBySellableInventory(
      [rate("11"), rate("12"), rate("13")],
      [availability("11", null), availability("12", 2, stale)],
      NOW,
    );
    expect(result.unverified).toBe(3);
    expect(result.sellable).toEqual([]);
  });

  it("suppresses an explicitly inactive rate plan and a closed-to-arrival plan", () => {
    const closed = { ...rate("11"), closed_to_arrival: true };
    const inactive = rate("12", "disabled");
    const result = filterRatesBySellableInventory(
      [closed, inactive],
      [availability("11", 1), availability("12", 1)],
      NOW,
      new Set([makeRateAlertPlanKey("12", "disabled")]),
    );
    expect(result.closedPlan).toBe(2);
    expect(result.sellable).toEqual([]);
  });

  it("keeps a different active rate plan for the same room eligible", () => {
    const result = filterRatesBySellableInventory(
      [rate("12", "active")],
      [availability("12", 2)],
      NOW,
      new Set([makeRateAlertPlanKey("12", "disabled")]),
    );
    expect(result.sellable).toHaveLength(1);
  });
});
