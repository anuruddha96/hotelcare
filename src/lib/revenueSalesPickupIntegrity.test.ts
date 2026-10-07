import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDayMetrics,
  countsTowardRevenueSalesPickup,
  type BookingNight,
} from "./revenueAnalytics";

function night(overrides: Partial<BookingNight> = {}): BookingNight {
  return {
    res_id: "normal-1",
    room_key: "room-1",
    obk_id: "817569",
    room_type_name: "Deluxe One-Bedroom Apartment",
    stay_date: "2026-10-31",
    stay_from: "2026-10-31",
    stay_to: "2026-11-01",
    nightly_price_eur: 120,
    created_at_pms: "2026-10-07T10:00:00Z",
    source_name: null,
    guests: 2,
    ...overrides,
  };
}

describe("revenue sales/pickup integrity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("keeps normal source-less direct bookings in sales and pickup", () => {
    expect(countsTowardRevenueSalesPickup(night())).toBe(true);
  });

  it("suppresses source-less multi-year inventory holds from sales and pickup", () => {
    const hold = night({
      res_id: "116823787",
      stay_from: "2026-10-31",
      stay_to: "2029-11-11",
      source_name: null,
    });
    expect(countsTowardRevenueSalesPickup(hold)).toBe(false);

    const [metric] = buildDayMetrics({
      from: "2026-10-31",
      to: "2026-10-31",
      nights: [hold],
      snapshots: [],
      cancellations: [],
      movements: [],
      ratedDates: new Set(),
      roomsAvailable: 82,
      windowDays: -48,
    });

    expect(metric.newBookings).toBe(0);
    expect(metric.netPickup).toBe(0);
    // The hold is deliberately retained in the on-the-books inventory picture.
    expect(metric.roomsSold).toBe(1);
  });

  it("does not suppress a channel-attributed long stay", () => {
    expect(countsTowardRevenueSalesPickup(night({
      stay_from: "2026-10-31",
      stay_to: "2029-11-11",
      source_name: "Booking.com XML",
    }))).toBe(true);
  });
});
