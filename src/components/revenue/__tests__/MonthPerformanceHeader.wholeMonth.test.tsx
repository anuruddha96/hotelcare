import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MonthPerformanceHeader from "../MonthPerformanceHeader";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import type { ReconciliationDay } from "@/lib/kpiReconciliation";

vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => ({ language: "en" }) }));
vi.mock("recharts", async (original) => ({ ...await original<object>(), ResponsiveContainer: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/revenueCurrency", () => ({
  money: (n: number) => `€${Math.round(n)}`,
  eurEquivalent: () => "",
  setRevenueCurrency: () => {},
  setDisplayCurrency: () => {},
  currencySymbol: () => "€",
  useRevenueCurrency: () => ({ code: "EUR", displayCode: "EUR", eurRate: null }),
  isForeignCurrency: () => false,
}));

const recon: { data?: ReconciliationDay[]; isLoading: boolean } = { data: undefined, isLoading: false };
vi.mock("@/hooks/useMonthReconciliationDays", () => ({
  useMonthReconciliationDays: () => recon,
  monthReconciliationKey: () => [],
}));

/** From-today metrics, as the page loads them: 12-30 November, 10 rooms, 7 sold a night at €145. */
const METRICS = Array.from({ length: 19 }, (_, i) => {
  const d = String(12 + i).padStart(2, "0");
  return {
    stay_date: `2026-11-${d}`, roomsSold: 7, roomsAvailable: 10, occupancyPct: 70, revenueEur: 7 * 145,
    adrEur: 145, revparEur: 101.5, roomsLeft: 3, newBookings: 0, cancelledBookings: 0, newRevenueEur: 0,
    lostRevenueEur: 0, roomsLost: 0, baselineAvailable: true, netPickup: 0, hasData: true,
  } as unknown as DayMetrics;
});

/** The same month from the server: 11 nights stayed at 100%, 19 on the books at 70%. */
const DAYS: ReconciliationDay[] = Array.from({ length: 30 }, (_, i) => {
  const past = i < 11;
  const sold = past ? 10 : 7;
  return {
    hotel_id: "ottofiori", stay_date: `2026-11-${String(i + 1).padStart(2, "0")}`, is_past_night: past,
    capacity_rooms: 10, commercial_capacity: 10, booked_nights_all: sold, hold_nights: 0, commercial_sold: sold,
    unassigned_nights: 0, option_nights: 0, previo_dashboard_occupied: sold, best_source: past ? "housekeeping_verified" : "bookings_on_the_books",
    best_physical_occupied: sold, best_commercial_sold: sold, room_revenue_gross: sold * (past ? 100 : 145),
    unpriced_nights: 0, flags: [], breakfast_guests: sold * 2, breakfast_price_per_guest: null,
  };
});

const renderHeader = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MonthPerformanceHeader
        today="2026-11-12"
        metrics={METRICS}
        pickupWindowDays={2}
        onPickupWindowChange={() => {}}
        hotelId="ottofiori"
        roomsAvailable={10}
        loadedThrough="2026-12-31"
      />
    </QueryClientProvider>,
  );

describe("MonthPerformanceHeader — whole month", () => {
  beforeAll(() => {
    // jsdom has no layout: the KPI strip's scroll helpers need stubs.
    Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
    window.matchMedia = vi.fn().mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as typeof window.matchMedia;
  });

  it("shows the whole month (stayed + on the books), not only the nights from today", () => {
    recon.data = DAYS; recon.isLoading = false;
    renderHeader();
    // 110 stayed + 133 on the books = 243 of 300 room-nights = 81%.
    expect(screen.getAllByText("81%").length).toBeGreaterThan(0);
    expect(screen.getByText("243 of 300 room-nights · whole month")).toBeTruthy();
    // ADR (110 x 100 + 133 x 145) / 243 = €125, labelled as including breakfast.
    expect(screen.getAllByText("€125").length).toBeGreaterThan(0);
    expect(screen.getByText("whole month · incl. breakfast & extras")).toBeTruthy();
    const table = screen.getByTestId("month-breakdown").textContent ?? "";
    expect(table).toMatch(/Already stayed1–11110\/110100%/);
    expect(table).toMatch(/On the books12–30133\/19070%€145/);
    expect(table).toMatch(/Whole month1–30243\/30081%€125/);
    // The from-today figure (70%) is no longer presented as the month.
    expect(screen.queryByText(/133 of 190 room-nights/)).toBeNull();
  });

  it("keeps gross whole-month ADR as the headline and room-only ADR in optional details", () => {
    recon.data = DAYS.map((d) => ({ ...d, breakfast_price_per_guest: 12.5 }));
    renderHeader();
    // Room-only: (30,285 - 486 breakfasts x 12.5) / 243 = €100.
    expect(screen.getAllByText("€125").length).toBeGreaterThan(0);
    expect(screen.getAllByText("€100").length).toBeGreaterThan(0);
    expect(screen.getByText("ADR calculation & breakfast settings").closest("details")?.open).toBe(false);
  });

  it("refuses to label future-only figures as whole-month ADR when the month request fails", () => {
    recon.data = undefined; recon.isLoading = false;
    renderHeader();
    expect(screen.getByText(/Partial ADR is not shown as monthly ADR/)).toBeTruthy();
    expect(screen.getAllByText("Monthly data unavailable").length).toBeGreaterThan(0);
    expect(screen.queryByText("€145")).toBeNull();
    expect(screen.queryByTestId("month-breakdown")).toBeNull();
  });
});
