import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DayMetrics } from "@/lib/revenueAnalytics";
import type { ReconciliationDay } from "@/lib/kpiReconciliation";

const { portfolio, benchmark, monthQueries, refetch } = vi.hoisted(() => ({
  portfolio: vi.fn(), benchmark: vi.fn(), monthQueries: vi.fn(), refetch: vi.fn(),
}));
vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<object>(), useQueries: (...args: unknown[]) => monthQueries(...args),
}));
vi.mock("@/hooks/usePortfolioSnapshots", () => ({ usePortfolioSnapshots: portfolio }));
vi.mock("@/hooks/usePortfolioRateBenchmark", () => ({ usePortfolioRateBenchmark: benchmark }));
vi.mock("@/hooks/useMonthReconciliationDays", () => ({
  monthReconciliationKey: (id: string, month: string) => ["kpi-reconciliation-days", id, month],
  fetchMonthReconciliationDays: vi.fn(),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("recharts", async (original) => ({ ...await original<object>(), ResponsiveContainer: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [
    { hotel_id: "ottofiori", base_currency: "EUR", eur_conversion_rate: 1 },
    { hotel_id: "gozsdu-court", base_currency: "EUR", eur_conversion_rate: 1 },
    { hotel_id: "memories-budapest", base_currency: "EUR", eur_conversion_rate: 1 },
    { hotel_id: "mika-downtown", base_currency: "EUR", eur_conversion_rate: 1 },
  ], error: null }) }) }) },
}));
vi.mock("@/hooks/useMarketRates", () => ({
  useMarketRates: () => ({ competitors: [], marketByDate: new Map(), ratesByCompetitor: new Map(), reliabilityByCompetitor: new Map() }),
}));
import MarketIntelligenceChart from "./MarketIntelligenceChart";

const hotels = [
  { hotel_id: "ottofiori", hotel_name: "Hotel Ottofiori" },
  { hotel_id: "gozsdu-court", hotel_name: "Gozsdu Court Budapest" },
  { hotel_id: "memories-budapest", hotel_name: "Hotel Memories Budapest" },
  { hotel_id: "mika-downtown", hotel_name: "Hotel Mika Downtown" },
];
const metrics = [{ stay_date: "2026-09-04", roomsSold: 10, roomsAvailable: 20, revenueEur: 1500,
  occupancyPct: 50, adrEur: 150, roomsLeft: 10 }] as DayMetrics[];

// Each hotel has a full 30-day reconciliation, despite the rate grid only
// having one future day. The comparison must never use the one-day grid sample.
const fullMonth = (hotelId: string, index: number): ReconciliationDay[] =>
  Array.from({ length: 30 }, (_, i) => {
    const sold = 10 + index;
    const rate = 150 - index * 10;
    return {
      hotel_id: hotelId, stay_date: `2026-09-${String(i + 1).padStart(2,"0")}`, is_past_night: i < 4,
      capacity_rooms: 20, commercial_capacity: 20, booked_nights_all: sold,
      hold_nights: 0, commercial_sold: sold, unassigned_nights: 0, option_nights: 0,
      previo_dashboard_occupied: sold, best_source: i < 4 ? "housekeeping_verified" : "bookings_on_the_books",
      best_physical_occupied: sold, best_commercial_sold: sold,
      room_revenue_gross: sold * rate, unpriced_nights: 0, flags: [],
    } as ReconciliationDay;
  });
const queries = () => hotels.map((hotel, index) => ({
  data: fullMonth(hotel.hotel_id, index), isFetching: false, isError: false, refetch,
}));
const portfolioReady = () => ({ data: [], isError: false, isPending: false, isFetching: false, refetch });

async function openComparison() {
  await act(async () => { render(<MarketIntelligenceChart hotels={hotels} hotelId="ottofiori" selectedMonth="2026-09" metrics={metrics} />); });
  if (!screen.queryByRole("region", { name: "Hotel comparison" })) fireEvent.click(screen.getByRole("button", { name: "Compare hotels" }));
  return screen.getByRole("region", { name: "Hotel comparison" });
}

beforeEach(() => {
  portfolio.mockReset().mockReturnValue(portfolioReady());
  benchmark.mockReset().mockReturnValue({ data: { available: false, days: [] }, isFetching: false });
  monthQueries.mockReset().mockImplementation(() => queries());
  refetch.mockReset();
});

describe("hotel comparison — reconciled full months", () => {
  it("shows whole-month occupancy, gross ADR and RevPAR for each property", async () => {
    const comparison = await openComparison();
    await waitFor(() => expect(within(comparison).getByText("€150")).toBeInTheDocument());
    for (const [index, hotel] of hotels.entries()) {
      const card = within(comparison).getByText(hotel.hotel_name).parentElement!.parentElement!;
      const sold = 10 + index, adr = 150 - index * 10;
      expect(within(card).getByText(`${Math.round(sold / 20 * 100)}%`)).toBeInTheDocument();
      expect(within(card).getByText(`€${adr}`)).toBeInTheDocument();
      expect(within(card).getByText(`€${Math.round(sold * adr / 20)}`)).toBeInTheDocument();
      expect(within(card).getByText("30 full-month dates checked")).toBeInTheDocument();
    }
    expect(within(comparison).getByText(/stayed \+ booked · ADR and RevPAR include breakfast/)).toBeInTheDocument();
  });

  it("refuses to show a partial 19-day ADR as full-month ADR", async () => {
    monthQueries.mockImplementation(() => queries().map((query, i) => i === 0 ? { ...query, data: query.data.slice(11) } : query));
    const comparison = await openComparison();
    const card = within(comparison).getByText("Hotel Ottofiori").parentElement!.parentElement!;
    expect(within(card).getByText("Full-month data unavailable")).toBeInTheDocument();
    expect(within(card).queryByText("€150")).toBeNull();
  });

  it("shows reconciliation errors without inventing values and permits retry", async () => {
    monthQueries.mockImplementation(() => queries().map((query) => ({ ...query, data: undefined, isError: true })));
    const comparison = await openComparison();
    expect(within(comparison).getByRole("alert")).toHaveTextContent("Some hotels could not be reconciled");
    fireEvent.click(within(comparison).getByRole("button", { name: "Retry comparison" }));
    expect(refetch).toHaveBeenCalledTimes(hotels.length);
  });

  it("clearly marks unavailable month data while loading", async () => {
    monthQueries.mockImplementation(() => queries().map((query) => ({ ...query, data: undefined, isFetching: true })));
    const comparison = await openComparison();
    expect(within(comparison).getByRole("button", { name: "Loading comparison…" })).toBeDisabled();
    expect(within(comparison).getAllByText("Full-month data unavailable")).toHaveLength(hotels.length);
  });
});

describe("rate benchmark fallback", () => {
  it("keeps the rate-position benchmark when external competitors are missing", async () => {
    benchmark.mockReturnValue({ data: { available: true, marketCity: "Budapest", propertiesReporting: 7,
      days: [{ date: "2026-09-04", propertiesReporting: 7, medianRate: 132, trimmedAverageRate: 136 }] }, isFetching: false });
    await act(async () => { render(<MarketIntelligenceChart hotels={hotels} hotelId="ottofiori" selectedMonth="2026-09" metrics={metrics} ourRateByDate={new Map([["2026-09-04", 150]])} />); });
    expect(screen.getByText(/HotelCare Budapest portfolio benchmark · 7 anonymized properties/)).toBeInTheDocument();
    expect(screen.getByText("Market benchmark")).toBeInTheDocument();
  });
});
