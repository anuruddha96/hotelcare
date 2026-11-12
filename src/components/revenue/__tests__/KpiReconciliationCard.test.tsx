import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import KpiReconciliationCard, { KpiReconciliationView } from "../KpiReconciliationCard";
import {
  buildMonthBreakdown,
  summariseReconciliationDays,
  type KpiReconciliationMonth,
  type ReconciliationDay,
} from "@/lib/kpiReconciliation";

const lang = { language: "en" };
vi.mock("@/hooks/useTranslation", () => ({ useTranslation: () => lang }));

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, args: Record<string, string>) => rpc(fn, args) },
}));

// Gozsdu Court, December 2026, as the reconciliation view returned it on 2026-11-12.
const GOZSDU_DEC: KpiReconciliationMonth = {
  hotel_id: "gozsdu-court",
  month_start: "2026-12-01",
  capacity_room_nights: 2542,
  booked_nights_all: 1773,
  hold_nights: 465,
  commercial_sold: 1308,
  unassigned_nights: 35,
  option_nights: 99,
  previo_dashboard_occupied: 1738,
  past_nights: 0,
  housekeeping_verified_nights: 0,
  housekeeping_mismatch_nights: 0,
  previo_dashboard_occupancy_pct: 68.4,
  hotelcare_commercial_occupancy_pct: 63.0,
  best_physical_occupancy_pct: 69.7,
  best_commercial_occupancy_pct: 63.0,
};

// Ottofiori, November 2026: past nights checked against housekeeping, nothing unusual.
const OTTOFIORI_NOV: KpiReconciliationMonth = {
  hotel_id: "ottofiori",
  month_start: "2026-11-01",
  capacity_room_nights: 630,
  booked_nights_all: 507,
  hold_nights: 0,
  commercial_sold: 507,
  unassigned_nights: 0,
  option_nights: 0,
  previo_dashboard_occupied: 507,
  past_nights: 11,
  housekeeping_verified_nights: 11,
  housekeeping_mismatch_nights: 0,
  previo_dashboard_occupancy_pct: 80.5,
  hotelcare_commercial_occupancy_pct: 80.5,
  best_physical_occupancy_pct: 80.5,
  best_commercial_occupancy_pct: 80.5,
};

describe("KpiReconciliationView", () => {
  beforeEach(() => { lang.language = "en"; });

  it("shows the three figures and explains every cause of the Gozsdu gap", () => {
    render(<KpiReconciliationView row={GOZSDU_DEC} />);
    expect(screen.getByText("68%")).toBeTruthy(); // Previo dashboard
    expect(screen.getByText("63%")).toBeTruthy(); // HotelCare commercial
    expect(screen.getByText("70%")).toBeTruthy(); // verified (future: bookings on the books)
    expect(screen.getByText("Gap vs Previo: +35 room-nights")).toBeTruthy();
    expect(screen.getByText(/35 booked room-nights have no room assigned yet/)).toBeTruthy();
    expect(screen.getByText(/465 room-nights are multi-year holds/)).toBeTruthy();
    expect(screen.getByText(/99 room-nights are options/)).toBeTruthy();
    expect(screen.getByText("Future: every booking on the books")).toBeTruthy();
  });

  it("says Previo's ADR is room-only and can lag same-morning bookings", () => {
    render(<KpiReconciliationView row={GOZSDU_DEC} />);
    expect(screen.getByText(/Previo's dashboard ADR is room-only/)).toBeTruthy();
    expect(screen.getByText(/lag bookings made the same morning/)).toBeTruthy();
  });

  it("shows no gap or reasons when both systems agree", () => {
    render(<KpiReconciliationView row={OTTOFIORI_NOV} />);
    expect(screen.queryByText(/Gap vs Previo/)).toBeNull();
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.getByText("11/11 past nights checked against housekeeping")).toBeTruthy();
  });

  it("renders a dash, not NaN, when a percentage is missing", () => {
    const { container } = render(
      <KpiReconciliationView row={{ ...OTTOFIORI_NOV, hotelcare_commercial_occupancy_pct: null }} />,
    );
    expect(screen.getByText("—")).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined/);
  });

  it("speaks Hungarian", () => {
    render(<KpiReconciliationView row={GOZSDU_DEC} hu />);
    expect(screen.getByText("Kihasználtság egyeztetés")).toBeTruthy();
    expect(screen.getByText("Eltérés a Previótól: +35 éj")).toBeTruthy();
    expect(screen.getByText(/csak a szobaár/)).toBeTruthy();
  });
});

/** A small hotel: 10 rooms, 4 nights; two already stayed, two on the books. */
const day = (stay_date: string, past: boolean, sold: number, revenue: number, extra: Partial<ReconciliationDay> = {}): ReconciliationDay => ({
  hotel_id: "ottofiori",
  stay_date,
  is_past_night: past,
  capacity_rooms: 10,
  commercial_capacity: 10,
  booked_nights_all: sold,
  hold_nights: 0,
  commercial_sold: sold,
  unassigned_nights: 0,
  option_nights: 0,
  previo_dashboard_occupied: sold,
  best_source: past ? "housekeeping_verified" : "bookings_on_the_books",
  best_physical_occupied: sold,
  best_commercial_sold: sold,
  room_revenue_gross: String(revenue),
  unpriced_nights: 0,
  flags: [],
  ...extra,
});
const NOV_DAYS: ReconciliationDay[] = [
  day("2026-11-10", true, 10, 900),
  day("2026-11-11", true, 10, 1000),
  day("2026-11-12", false, 6, 900, { unassigned_nights: 1, previo_dashboard_occupied: 5 }),
  day("2026-11-13", false, 8, 1500),
];

describe("month breakdown", () => {
  it("adds stayed and on-the-books nights up to the whole month", () => {
    const rows = buildMonthBreakdown(NOV_DAYS);
    expect(rows.map((r) => r.key)).toEqual(["stayed", "books", "month"]);
    const [stayed, books, month] = rows;
    expect(stayed).toMatchObject({ firstDay: "2026-11-10", lastDay: "2026-11-11", sold: 20, occupancyPct: 100, adrGross: 95 });
    expect(books).toMatchObject({ sold: 14, occupancyPct: 70, adrGross: 171.43 });
    expect(month).toMatchObject({ sold: 34, capacity: 40, occupancyPct: 85, adrGross: 126.47 });
    expect(month.sold).toBe(stayed.sold + books.sold);
  });

  it("leaves unpriced (group / complimentary) nights out of ADR but not out of occupancy", () => {
    const [only] = buildMonthBreakdown([day("2026-12-01", false, 4, 300, { unpriced_nights: 1 })]);
    expect(only).toMatchObject({ sold: 4, occupancyPct: 40, adrGross: 100 });
  });

  it("shows no whole-month line when the month is entirely past or entirely future", () => {
    expect(buildMonthBreakdown(NOV_DAYS.filter((d) => !d.is_past_night)).map((r) => r.key)).toEqual(["books"]);
  });

  it("summarises days with the same formulas as the database function", () => {
    expect(summariseReconciliationDays(NOV_DAYS)).toMatchObject({
      month_start: "2026-11-01",
      capacity_room_nights: 40,
      booked_nights_all: 34,
      previo_dashboard_occupied: 33,
      unassigned_nights: 1,
      past_nights: 2,
      housekeeping_verified_nights: 2,
      previo_dashboard_occupancy_pct: 82.5,
      hotelcare_commercial_occupancy_pct: 85,
    });
    expect(summariseReconciliationDays([])).toBeNull();
  });
});

describe("KpiReconciliationCard", () => {
  beforeEach(() => { rpc.mockReset(); lang.language = "en"; });

  it("loads one hotel-month through the fast function and shows how it adds up", async () => {
    rpc.mockResolvedValue({ data: NOV_DAYS, error: null });
    render(<KpiReconciliationCard hotelId="ottofiori" month="2026-11" />);
    await waitFor(() => expect(screen.getByTestId("kpi-reconciliation")).toBeTruthy());
    expect(rpc).toHaveBeenCalledWith("revenue_kpi_reconciliation_days", {
      p_hotel_id: "ottofiori",
      p_from: "2026-11-01",
      p_to: "2026-11-01",
    });
    const table = screen.getByTestId("kpi-month-breakdown");
    expect(table.textContent).toMatch(/Already stayed10–11/);
    expect(table.textContent).toMatch(/On the books12–13/);
    expect(table.textContent).toMatch(/Whole month10–133485%€126/);
    expect(screen.getByText("Gap vs Previo: +1 room-nights")).toBeTruthy();
  });

  it("renders nothing when the function is missing or access is denied", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "42883" } });
    const { container } = render(<KpiReconciliationCard hotelId="mika-downtown" month="2026-11" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for a hotel the user cannot access (no rows)", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const { container } = render(<KpiReconciliationCard hotelId="memories-budapest" month="2026-11" />);
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(container.innerHTML).toBe("");
  });

  it("does not query without a hotel or with a malformed month", () => {
    render(<KpiReconciliationCard hotelId={null} month="2026-11" />);
    render(<KpiReconciliationCard hotelId="ottofiori" month="November" />);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("uses Hungarian when the app language is Hungarian", async () => {
    lang.language = "hu";
    rpc.mockResolvedValue({ data: NOV_DAYS, error: null });
    render(<KpiReconciliationCard hotelId="ottofiori" month="2026-11" />);
    await waitFor(() => expect(screen.getByText("Kihasználtság egyeztetés")).toBeTruthy());
    expect(screen.getByText("Hogyan áll össze a hónap")).toBeTruthy();
  });
});
