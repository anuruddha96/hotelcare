import { describe, expect, it } from "vitest";
import { bookingGoalScope, buildGoalPriceChanges, calendarGoalRowScope, goalMonthRange } from "@/lib/adrGoalAdjustment";
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

describe("ADR goal full calendar-row changes", () => {
  it("moves every day and every guest price in the selected room row by the exact same amount", () => {
    const scope = calendarGoalRowScope(["Deluxe Twin Room"], "2026-12-10", "2026-12-12");
    const rates = [
      rate("2026-12-10", "Deluxe Twin Room", 1, 158),
      rate("2026-12-10", "Deluxe Twin Room", 2, 168),
      rate("2026-12-11", "Deluxe Twin Room", 1, 170),
      rate("2026-12-11", "Deluxe Twin Room", 2, 180),
      rate("2026-12-12", "Deluxe Twin Room", 1, 190),
      rate("2026-12-12", "Deluxe Twin Room", 2, 200),
      rate("2026-12-11", "Economy Double", 1, 100),
      rate("2026-12-13", "Deluxe Twin Room", 1, 210),
    ];
    const result = buildGoalPriceChanges(rates, scope, 16, "2026-11-14");
    expect(result.invalid).toBe(false);
    expect(result.missing).toEqual([]);
    expect(result.missingTiers).toEqual([]);
    expect(result.changes.map(({ rate, from, to }) => [rate.stay_date, rate.occupancy, from, to])).toEqual([
      ["2026-12-10", 1, 158, 174],
      ["2026-12-10", 2, 168, 184],
      ["2026-12-11", 1, 170, 186],
      ["2026-12-11", 2, 180, 196],
      ["2026-12-12", 1, 190, 206],
      ["2026-12-12", 2, 200, 216],
    ]);
  });

  it("covers the whole booking month by default rather than only the booked stay", () => {
    expect(goalMonthRange("2026-12-10", "2026-12-10", "2026-11-14"))
      .toEqual({ from: "2026-12-01", to: "2026-12-31" });
    expect(calendarGoalRowScope(["Deluxe Twin Room"], "2026-12-01", "2026-12-31")).toHaveLength(31);
    expect(goalMonthRange("2026-11-10", "2026-11-10", "2026-11-14"))
      .toEqual({ from: "2026-11-14", to: "2026-11-30" });
  });

  it("blocks a partial room row when a required occupancy price is missing", () => {
    const scope = calendarGoalRowScope(["Twin"], "2026-12-10", "2026-12-11");
    const result = buildGoalPriceChanges([
      rate("2026-12-10", "Twin", 1, 90), rate("2026-12-10", "Twin", 2, 100),
      rate("2026-12-11", "Twin", 2, 110),
    ], scope, 16, "2026-11-14");
    expect(result.missing).toEqual([]);
    expect(result.missingTiers).toEqual([{ stayDate: "2026-12-11", roomTypeName: "Twin", occupancy: 1 }]);
  });

  it("rejects invalid, reversed and overlong periods instead of silently shortening changes", () => {
    expect(calendarGoalRowScope(["Twin"], "2026-12-31", "2026-12-01")).toEqual([]);
    expect(calendarGoalRowScope(["Twin"], "2026-02-30", "2026-03-01")).toEqual([]);
    expect(calendarGoalRowScope(["Twin"], "2026-01-01", "2027-12-31")).toEqual([]);
  });
});
