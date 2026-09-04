import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DayMetrics } from "@/lib/revenueAnalytics";

const { portfolio, refetch } = vi.hoisted(() => ({ portfolio: vi.fn(), refetch: vi.fn() }));
vi.mock("@/hooks/usePortfolioSnapshots", () => ({ usePortfolioSnapshots: portfolio }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("recharts", async (original) => ({ ...await original<object>(), ResponsiveContainer: () => null }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({ select: () => ({ in: async () => ({ data: [], error: null }) }) }) } }));
vi.mock("@/hooks/useMarketRates", () => ({ useMarketRates: () => ({ competitors: [], marketByDate: new Map(), ratesByCompetitor: new Map(), reliabilityByCompetitor: new Map() }) }));
import MarketIntelligenceChart from "./MarketIntelligenceChart";

const hotels = [
  { hotel_id: "ottofiori", hotel_name: "Hotel Ottofiori" },
  { hotel_id: "gozsdu-court", hotel_name: "Gozsdu Court Budapest" },
  { hotel_id: "memories-budapest", hotel_name: "Hotel Memories Budapest" },
  { hotel_id: "mika-downtown", hotel_name: "Hotel Mika Downtown" },
];
const metrics = [{ stay_date: "2026-09-04", roomsSold: 10, roomsAvailable: 20, revenueEur: 1500, occupancyPct: 50, adrEur: 150, roomsLeft: 10 }] as DayMetrics[];
const snapshots = hotels.slice(1).map((h, i) => ({ hotel_id: h.hotel_id, stay_date: "2026-09-04", rooms_sold: 10 + i, rooms_available: 20, revenue_eur: (10 + i) * (100 + i * 20), occupancy_pct: 50 + i * 5, adr_eur: 100 + i * 20 }));
const ready = () => ({ data: snapshots, isError: false, isPending: false, isFetching: false, refetch });

async function openComparison() {
  await act(async () => { render(<MarketIntelligenceChart hotels={hotels} hotelId="ottofiori" selectedMonth="2026-09" metrics={metrics} />); });
  if (!screen.queryByRole("region", { name: "Hotel comparison" })) fireEvent.click(screen.getByRole("button", { name: "Compare hotels" }));
  return screen.getByRole("region", { name: "Hotel comparison" });
}

beforeEach(() => { portfolio.mockReset().mockReturnValue(ready()); refetch.mockReset(); });

describe("hotel comparison cards", () => {
  it("renders occupancy, ADR and RevPAR for every hotel", async () => {
    const comparison = await openComparison();
    for (const [i, hotel] of hotels.entries()) {
      const card = within(comparison).getByText(hotel.hotel_name).parentElement!.parentElement!;
      const values = i === 0 ? ["50%", "€150", "€75"] : [["50%", "€100", "€50"], ["55%", "€120", "€66"], ["60%", "€140", "€84"]][i - 1];
      values.forEach((value) => expect(within(card).getByText(value)).toBeInTheDocument());
      expect(within(card).queryByText("—")).not.toBeInTheDocument();
    }
  });

  it("explains a loading failure and offers a working retry", async () => {
    portfolio.mockReturnValue({ ...ready(), data: undefined, isError: true });
    const comparison = await openComparison();
    expect(within(comparison).getByRole("alert")).toHaveTextContent("Comparison figures could not load");
    expect(within(comparison).queryByText(/pts vs portfolio/)).not.toBeInTheDocument();
    fireEvent.click(within(comparison).getByRole("button", { name: "Retry comparison" }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("shows that missing hotel figures are still loading", async () => {
    portfolio.mockReturnValue({ ...ready(), data: undefined, isPending: true, isFetching: true });
    const comparison = await openComparison();
    expect(within(comparison).getAllByText("Loading figures…")).toHaveLength(3);
    expect(within(comparison).getByRole("button", { name: "Loading comparison…" })).toBeDisabled();
  });

  it("labels retained figures when a refresh fails", async () => {
    portfolio.mockReturnValue({ ...ready(), isError: true });
    const comparison = await openComparison();
    expect(within(comparison).getByRole("alert")).toHaveTextContent("Showing the last loaded figures");
    expect(within(comparison).getByText("€120")).toBeInTheDocument();
  });
});
