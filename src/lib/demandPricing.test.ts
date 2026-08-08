import { describe, expect, it } from "vitest";
import {
  DEFAULT_LADDER, applyPreset, burstCount, hoursSinceLastBooking,
  pickupUpliftEur, suggestLadderPrice, type LadderSettings,
} from "./demandPricing";

const now = new Date("2026-08-08T12:00:00Z");
const eurHotel: LadderSettings = { ...DEFAULT_LADDER, minAdr: 120, eurToBase: 1 };
const hufHotel: LadderSettings = { ...DEFAULT_LADDER, minAdr: 40000, eurToBase: 400 };

const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString();

describe("pickup ladder", () => {
  it("counts only bookings inside the burst window", () => {
    expect(burstCount([minsAgo(10), minsAgo(50), minsAgo(120)], now, 60)).toBe(2);
  });

  it("treats the tiers as day totals, not increments", () => {
    expect(pickupUpliftEur(1, eurHotel)).toBe(11);
    expect(pickupUpliftEur(2, eurHotel)).toBe(18);
    expect(pickupUpliftEur(5, eurHotel)).toBe(40);
  });

  it("raises the price by the tier total", () => {
    const r = suggestLadderPrice({
      currentPrice: 150, bookingTimes: [minsAgo(5), minsAgo(20)], now, settings: eurHotel,
    });
    expect(r.suggestedPrice).toBe(168);
    expect(r.burstBookings).toBe(2);
  });

  it("converts EUR rules to the hotel currency", () => {
    const r = suggestLadderPrice({
      currentPrice: 60000, bookingTimes: [minsAgo(5)], now, settings: hufHotel,
    });
    expect(r.suggestedPrice).toBe(60000 + 11 * 400);
  });
});

describe("idle decay", () => {
  it("shaves one unit per idle block", () => {
    const r = suggestLadderPrice({
      currentPrice: 150, bookingTimes: [new Date(now.getTime() - 7 * 3_600_000).toISOString()], now, settings: eurHotel,
    });
    expect(r.hoursIdle).toBe(7);
    expect(r.suggestedPrice).toBe(148); // 2 full 3h blocks
  });

  it("does not shave a price the manager set by hand today", () => {
    const r = suggestLadderPrice({
      currentPrice: 150, bookingTimes: [new Date(now.getTime() - 9 * 3_600_000).toISOString()],
      now, settings: eurHotel, manuallyPriced: true,
    });
    expect(r.suggestedPrice).toBe(150);
  });

  it("reports no idle time when nothing has sold", () => {
    expect(hoursSinceLastBooking([], now)).toBeNull();
  });
});

describe("demand grade and the minimum rate", () => {
  it("takes 2 EUR off a low-demand day", () => {
    const r = suggestLadderPrice({ currentPrice: 150, bookingTimes: [], now, rating: "low", settings: eurHotel });
    expect(r.suggestedPrice).toBe(148);
  });

  it("never proposes a price below the minimum ADR", () => {
    const r = suggestLadderPrice({ currentPrice: 121, bookingTimes: [], now, rating: "low", settings: eurHotel });
    expect(r.suggestedPrice).toBe(120);
    expect(r.clampedByMinAdr).toBe(true);
  });

  it("holds the floor for percentage presets too", () => {
    expect(applyPreset(125, { id: "x", label: "", description: "", percent: -10 }, eurHotel)).toBe(120);
    expect(applyPreset(200, { id: "x", label: "", description: "", percent: 10 }, eurHotel)).toBe(220);
  });
});
