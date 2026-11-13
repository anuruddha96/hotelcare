import { describe, expect, it, vi } from "vitest";
import { buildYearComparison } from "./YearOverYearPanel";
import type { ReconciliationDay } from "@/lib/kpiReconciliation";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/revenueCurrency", () => ({ money: (n: number) => `€${Math.round(n)}` }));

function monthDays(month: string, count: number, sold: number, nightlyRate: number): ReconciliationDay[] {
  return Array.from({ length: count }, (_, index) => ({
    hotel_id: "ottofiori",
    stay_date: `${month}-${String(index + 1).padStart(2, "0")}`,
    is_past_night: true,
    capacity_rooms: 21, commercial_capacity: 21, booked_nights_all: sold,
    hold_nights: 0, commercial_sold: sold, unassigned_nights: 0, option_nights: 0,
    previo_dashboard_occupied: sold, best_source: "previo_assigned_rooms",
    best_physical_occupied: sold, best_commercial_sold: sold,
    room_revenue_gross: sold * nightlyRate, unpriced_nights: 0, flags: [],
  } as ReconciliationDay));
}

describe("verified year over year month comparisons", () => {
  const september = monthDays("2026-09", 30, 20, 143);
  const october = monthDays("2026-10", 31, 20, 144);
  const august = monthDays("2026-08", 31, 18, 122);
  const combined = [...august, ...september, ...october];
  const observed = combined.map((r) => ({ stay_date: r.stay_date }));

  it("reports September and October after August without adding repeated daily captures", () => {
    const snapshots = [...observed, ...observed, ...observed];
    const comparison = buildYearComparison(combined, snapshots, 2026);
    expect(comparison[8].now).toMatchObject({ yearMonth: "2026-09", days: 30, sold: 600, revenue: 85800, adr: 143, coverage: 30 });
    expect(comparison[9].now).toMatchObject({ yearMonth: "2026-10", days: 31, sold: 620, revenue: 89280, adr: 144, coverage: 31 });
    expect(comparison[8].lastYear).toBeNull();
    expect(comparison[9].lastYear).toBeNull();
  });
  it("flags an August archive that started after the first four nights", () => {
    const partial = observed.filter((d) => !d.stay_date.startsWith("2026-08-0") || Number(d.stay_date.slice(-2)) >= 5);
    expect(buildYearComparison(combined, partial, 2026)[7].now?.coverage).toBe(27);
  });
  it("never fabricates revenue for an unarchived year", () => {
    expect(buildYearComparison(monthDays("2025-10", 31, 20, 100), [], 2026)[9].lastYear).toBeNull();
  });
});
