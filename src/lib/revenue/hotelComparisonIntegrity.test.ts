import { describe, expect, it } from "vitest";
import type { ReconciliationDay } from "@/lib/kpiReconciliation";
import {
  validateHotelComparisonData,
  type ComparisonAvailabilityRow,
} from "./hotelComparisonIntegrity";

const month = "2026-11";
const today = "2026-11-21";
const nowMs = Date.parse("2026-11-21T19:45:00Z");
const lastSuccess = "2026-11-21T19:43:00Z";
const capturedAt = "2026-11-21T19:43:30Z";
const fetchedAt = Date.parse("2026-11-21T19:44:00Z");

function monthRows(futureSold: number): ReconciliationDay[] {
  return Array.from({ length: 30 }, (_, i) => {
    const stay_date = `2026-11-${String(i + 1).padStart(2, "0")}`;
    const sold = i < 20 ? (i === 19 ? 18 : 21) : futureSold;
    return {
      stay_date, hotel_id: "ottofiori", is_past_night: i < 20,
      commercial_capacity: 21, capacity_rooms: 21, commercial_sold: sold,
      booked_nights_all: sold, hold_nights: 0, unassigned_nights: 0,
      option_nights: 0, previo_dashboard_occupied: sold,
      best_source: "bookings_on_the_books", best_physical_occupied: sold,
      best_commercial_sold: sold, room_revenue_gross: sold * 120,
      unpriced_nights: 0, flags: [],
      bookings_captured_at: sold ? capturedAt : null,
    };
  });
}

function inventory(futureSold: number): ComparisonAvailabilityRow[] {
  return Array.from({ length: 10 }, (_, i) => ({
    hotel_id: "ottofiori", stay_date: `2026-11-${i + 21}`,
    availability: 21 - futureSold, captured_at: capturedAt,
  }));
}

const verify = (
  rows: ReconciliationDay[], availability: ComparisonAvailabilityRow[],
  extra: Partial<Parameters<typeof validateHotelComparisonData>[0]> = {},
) => validateHotelComparisonData({
  rows, availability, today, month, nowMs, reconciliationFetchedAt: fetchedAt,
  availabilityFetchedAt: fetchedAt, syncFetchedAt: fetchedAt,
  sync: { scope: "idle", last_success_at: lastSuccess },
  ...extra,
});

describe("Hotel comparison reconciliation", () => {
  it("rejects the past-only 66% screen even though all 30 calendar dates exist", () => {
    const partialRows = monthRows(0);
    // Previo inventory shows rooms already booked, but the reservation
    // reconciliation has lost every future room-night.
    const result = verify(partialRows, inventory(15));
    expect(result.bookingsVerified).toBe(false);
    expect(result.issue).toMatch(/availability indicates missing future bookings/);
  });

  it("accepts an intact stayed + booked month", () => {
    const result = verify(monthRows(15), inventory(15));
    expect(result).toEqual({
      bookingsVerified: true, pricesVerified: true, issue: null, priceIssue: null,
    });
  });

  it("rejects a cached snapshot fetched before the last successful PMS sync", () => {
    const result = verify(monthRows(15), inventory(15), {
      reconciliationFetchedAt: Date.parse("2026-11-21T19:40:00Z"),
    });
    expect(result.bookingsVerified).toBe(false);
  });

  it("keeps consistent existing numbers on screen while the next PMS sync runs", () => {
    const result = verify(monthRows(15), inventory(15), {
      sync: { scope: "this_property", last_success_at: lastSuccess },
    });
    expect(result.bookingsVerified).toBe(true);
    expect(result.issue).toMatch(/running/);
  });

  it("blocks a false monthly ADR when one sold night has no price", () => {
    const rows = monthRows(15);
    rows[21] = { ...rows[21], unpriced_nights: 1 };
    const result = verify(rows, inventory(15));
    expect(result.bookingsVerified).toBe(true);
    expect(result.pricesVerified).toBe(false);
    expect(result.priceIssue).toMatch(/1 sold room-nights/);
  });

  it("rejects duplicate or missing calendar dates instead of treating the spine as complete", () => {
    const rows = monthRows(15);
    rows[29] = { ...rows[28] };
    expect(verify(rows, inventory(15)).bookingsVerified).toBe(false);
  });

  it("keeps monthly numbers for a single overbooked date and surfaces a discreet warning", () => {
    const rows = monthRows(15);
    rows[27] = { ...rows[27], commercial_sold: 24, flags: ["overbooked_or_duplicate"] };
    const result = verify(rows, inventory(15));
    expect(result.bookingsVerified).toBe(true);
    expect(result.issue).toMatch(/configured capacity/);
  });

  it("rejects impossible negative sales even with a complete calendar spine", () => {
    const rows = monthRows(15);
    rows[27] = { ...rows[27], commercial_sold: -1 };
    expect(verify(rows, inventory(15)).bookingsVerified).toBe(false);
  });

  it("tolerates Previo reporting extra availability but keeps a small data warning", () => {
    const result = verify(monthRows(15), inventory(11));
    expect(result.bookingsVerified).toBe(true);
    expect(result.issue).toMatch(/higher PMS availability/);
  });

  it("rejects expired inventory instead of displaying it as current", () => {
    const avail = inventory(15);
    avail[0] = { ...avail[0], captured_at: "2026-11-20T10:00:00Z" };
    expect(verify(monthRows(15), avail).bookingsVerified).toBe(false);
  });
});
