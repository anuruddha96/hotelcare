import { describe, expect, it } from "vitest";
import {
  buildDayMetrics,
  countsTowardRevenueSalesPickup,
  isNonCommercialInventoryHold,
  type BookingNight,
} from "../revenueAnalytics";

function night(
  res_id: string,
  nightly_price_eur: number | null,
  options: Partial<BookingNight> = {},
): BookingNight {
  return {
    stay_date: "2026-11-10",
    res_id,
    room_key: res_id,
    obk_id: "active",
    room_type_name: "Active category",
    nightly_price_eur,
    created_at_pms: "2026-10-01T10:00:00Z",
    guests: 2,
    stay_from: "2026-11-10",
    stay_to: "2026-11-11",
    source_name: "Booking.com",
    ...options,
  };
}

function metrics(nights: BookingNight[], roomsAvailable: number, excludedRoomTypeIds?: Set<string>) {
  return buildDayMetrics({
    from: "2026-11-10",
    to: "2026-11-10",
    nights,
    snapshots: [],
    cancellations: [],
    movements: [],
    roomsAvailable,
    excludedRoomTypeIds,
    windowDays: -48,
    ratedDates: new Set(["2026-11-10"]),
  })[0];
}

describe("canonical Previo commercial KPIs", () => {
  it("excludes multi-year source-less Gozsdu holds from paid sales AND sellable capacity", () => {
    const hold = night("long-term-hold", 0, {
      room_key: "unit-14", source_name: null,
      stay_from: "2023-03-29", stay_to: "2027-04-30",
    });
    expect(isNonCommercialInventoryHold(hold)).toBe(true);
    expect(countsTowardRevenueSalesPickup(hold)).toBe(false);
    const day = metrics([
      hold,
      night("sold-1", 150),
      night("sold-2", 100),
    ], 82);
    expect(day.roomsSold).toBe(2);
    expect(day.roomsAvailable).toBe(81);
    expect(day.excludedInventoryHolds).toBe(1);
    expect(day.revenueEur).toBe(250);
    expect(day.adrEur).toBe(125);
    expect(day.occupancyPct).toBe(2.5);
    expect(day.revparEur).toBe(3.09);
    expect(day.roomsLeft).toBe(79);
  });

  it("retains normal source-less direct bookings and source-attributed long stays", () => {
    const direct = night("direct", 80, { source_name: null });
    const attributed = night("long-booking", 210, {
      source_name: "Booking.com", stay_from: "2023-03-29", stay_to: "2027-04-30",
    });
    expect(isNonCommercialInventoryHold(direct)).toBe(false);
    expect(isNonCommercialInventoryHold(attributed)).toBe(false);
    const day = metrics([direct, attributed], 10);
    expect(day.roomsSold).toBe(2);
    expect(day.roomsAvailable).toBe(10);
    expect(day.adrEur).toBe(145);
    expect(day.revparEur).toBe(29);
  });

  it("keeps multi-room group companions in the commercial ADR denominator", () => {
    const day = metrics([
      night("group", 300, { room_key: "first" }),
      night("group", 0, { room_key: "second" }),
    ], 2);
    expect(day.roomsSold).toBe(2);
    expect(day.revenueEur).toBe(300);
    expect(day.adrEur).toBe(150);
    expect(day.revparEur).toBe(150);
    expect(day.occupancyPct).toBe(100);
  });

  it("excludes explicitly inactive SLNT room categories without consuming capacity", () => {
    const day = metrics([
      night("active", 19000, { obk_id: "783103:1002775", source_currency: "HUF" } as Partial<BookingNight>),
      night("inactive", 30000, { obk_id: "782407:956289" }),
    ], 57, new Set(["782407:956289"]));
    expect(day.excludedInactiveNights).toBe(1);
    expect(day.roomsAvailable).toBe(57);
    expect(day.roomsSold).toBe(1);
    expect(day.revenueEur).toBe(19000);
    expect(day.adrEur).toBe(19000);
    expect(day.revparEur).toBe(333.33);
  });

  it("never silently certifies missing prices as zero", () => {
    const day = metrics([night("unpriced", null), night("normal", 100)], 10);
    expect(day.missingPriceNights).toBe(1);
    expect(day.roomsSold).toBe(2);
    expect(day.revenueEur).toBe(100);
  });

  it("includes a paid room rate even if it happens to be a long direct stay below one year", () => {
    const stay = night("seasonal", 700, {
      source_name: null, stay_from: "2026-09-01", stay_to: "2027-08-31",
    });
    expect(isNonCommercialInventoryHold(stay)).toBe(false);
    expect(metrics([stay], 1).adrEur).toBe(700);
  });

  it("does not average daily ADRs when comparing monthly KPI totals", () => {
    const d1 = metrics([night("a", 100)], 2);
    const d2 = buildDayMetrics({
      from: "2026-11-11", to: "2026-11-11",
      nights: [night("b", 200, { stay_date: "2026-11-11" }), night("c", 250, { stay_date: "2026-11-11" })],
      snapshots: [], roomsAvailable: 2, windowDays: -48,
    })[0];
    const totalRevenue = d1.revenueEur + d2.revenueEur;
    const sold = d1.roomsSold + d2.roomsSold;
    const capacity = d1.roomsAvailable + d2.roomsAvailable;
    expect(totalRevenue).toBe(550);
    expect(Number((totalRevenue / sold).toFixed(2))).toBe(183.33);
    expect(Number((totalRevenue / capacity).toFixed(2))).toBe(137.5);
  });
});
