import { describe, expect, it } from "vitest";
import { buildMonthBreakdown, wholeMonthOf, type ReconciliationDay } from "@/lib/kpiReconciliation";

const day = (date: string, unpriced: number): ReconciliationDay => ({
  hotel_id: "memories-budapest", stay_date: date, is_past_night: false,
  capacity_rooms: 10, commercial_capacity: 10, booked_nights_all: 2,
  hold_nights: 0, commercial_sold: 2, unassigned_nights: 0, option_nights: 0,
  previo_dashboard_occupied: 2, best_source: "bookings_on_the_books",
  best_physical_occupied: 2, best_commercial_sold: 2,
  room_revenue_gross: 100, unpriced_nights: unpriced,
  flags: unpriced ? ["unpriced_nights"] : ["zero_price_nights"],
  breakfast_guests: null, breakfast_price_per_guest: null,
});

describe("whole-month revenue with explicit €0 PMS rates", () => {
  it("includes €0-valued nights in sold ADR denominator, never treating them as NULL", () => {
    const row = wholeMonthOf(buildMonthBreakdown([
      day("2027-01-01", 0), day("2027-01-02", 0),
    ]));
    expect(row?.sold).toBe(4);
    expect(row?.priced).toBe(4);
    expect(row?.revenueGross).toBe(200);
    expect(row?.adrGross).toBe(50);
    expect(row?.revparGross).toBe(10);
  });
  it("still records truly missing NULL prices as incomplete", () => {
    const row = wholeMonthOf(buildMonthBreakdown([day("2027-01-01", 1)]));
    expect(row?.sold).toBe(2);
    expect(row?.priced).toBe(1);
  });
});
