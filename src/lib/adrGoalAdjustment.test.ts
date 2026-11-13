import { describe, expect, it } from "vitest";
import { bookingGoalScope, buildGoalPriceChanges } from "@/lib/adrGoalAdjustment";
import type { RoomTypeRate } from "@/lib/revenueAnalytics";

const rate = (date: string, type: string, occupancy: number, price: number): RoomTypeRate => ({
  stay_date: date, obk_id: type, room_type_name: type, occupancy, price, currency: "EUR",
});

describe("ADR goal booking-specific adjustment", () => {
  it("affects only actual booked nights and the booked room type, keeping occupancy steps", () => {
    const scope = bookingGoalScope([
      { roomType: "Deluxe Queen", dates: ["2026-12-23", "2026-12-25", "2026-12-25"] },
    ]);
    const rates = [
      rate("2026-12-23", "Deluxe Queen", 1, 120),
      rate("2026-12-23", "Deluxe Queen", 2, 145),
      rate("2026-12-24", "Deluxe Queen", 2, 155),
      rate("2026-12-25", "Deluxe Queen", 2, 160),
      rate("2026-12-26", "Deluxe Queen", 2, 170),
      rate("2026-12-23", "Other room", 2, 95),
    ];
    const result = buildGoalPriceChanges(rates, scope, 26, "2026-11-13");
    expect(result.missing).toEqual([]);
    expect(result.invalid).toBe(false);
    expect(result.changes.map((c) => [c.rate.stay_date, c.rate.occupancy, c.from, c.to])).toEqual([
      ["2026-12-23", 1, 120, 146],
      ["2026-12-23", 2, 145, 171],
      ["2026-12-25", 2, 160, 186],
    ]);
  });
  it("requires full coverage before offering a publish", () => {
    const scope = bookingGoalScope([{ roomType: "Queen", dates: ["2026-12-23", "2026-12-24"] }]);
    const result = buildGoalPriceChanges([rate("2026-12-23", "Queen", 2, 200)], scope, 26, "2026-11-13");
    expect(result.missing).toEqual([{ stayDate: "2026-12-24", roomTypeName: "Queen" }]);
  });
  it("supports decrease and rejects unsafe prices", () => {
    const scope = bookingGoalScope([{ roomType: "Queen", dates: ["2026-12-23"] }]);
    expect(buildGoalPriceChanges([rate("2026-12-23", "Queen", 2, 130)], scope, -10, "2026-11-13").changes[0].to).toBe(120);
    expect(buildGoalPriceChanges([rate("2026-12-23", "Queen", 2, 5)], scope, -10, "2026-11-13").invalid).toBe(true);
  });
  it("never includes historical nights", () => {
    const scope = bookingGoalScope([{ roomType: "Queen", dates: ["2026-11-12", "2026-11-14"] }]);
    const result = buildGoalPriceChanges([rate("2026-11-12", "Queen", 2, 100), rate("2026-11-14", "Queen", 2, 100)], scope, 20, "2026-11-13");
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].rate.stay_date).toBe("2026-11-14");
  });
});
